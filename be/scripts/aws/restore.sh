#!/usr/bin/env bash
# PostgreSQL plain SQL gzip backup restore

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

FORCE_MODE=false
LOCAL_MODE=false
TARGET=""
BACKUP_PATH=""
EXPECTED_DB_COUNT=6

usage() {
    cat <<EOF
Usage:
  $0 <backup_directory>
  $0 -f <backup_directory>
  $0 -local <backup_directory>
  $0 -f -local <backup_directory>
  $0 -i i-xxxxxxxxxxxxxxxxx <backup_directory>

Options:
  -f, --force             Drop and recreate existing databases
  -local, --local         Restore directly to local Docker containers
  -i, --instance-id ID    Restore to a specific EC2 instance
  -h, --help              Show help
EOF
}

# --------------------------------------------------------
# Argument parsing
# --------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--force)
            FORCE_MODE=true
            shift
            ;;

        -local|--local)
            LOCAL_MODE=true
            shift
            ;;

        -i|--instance-id)
            if [[ $# -lt 2 ]]; then
                err "$1 requires an instance ID."
                usage
                exit 1
            fi

            TARGET="$2"
            shift 2
            ;;

        -h|--help)
            usage
            exit 0
            ;;

        -*)
            err "Unknown option: $1"
            usage
            exit 1
            ;;

        *)
            if [[ -n "$BACKUP_PATH" ]]; then
                err "Only one backup path can be specified."
                exit 1
            fi

            BACKUP_PATH="$1"
            shift
            ;;
    esac
done

if [[ -z "$BACKUP_PATH" ]]; then
    err "Specify a backup directory."
    usage
    exit 1
fi

if [[ "$LOCAL_MODE" == true && -n "$TARGET" ]]; then
    err "--local and -i cannot be used together."
    exit 1
fi

if [[ -n "$TARGET" && "$TARGET" != i-* ]]; then
    err "Invalid instance ID: $TARGET"
    exit 1
fi

# --------------------------------------------------------
# Required tools
# --------------------------------------------------------

require_restore_tools() {
    if ! command -v gzip >/dev/null 2>&1; then
        err "gzip is required."
        return 1
    fi

    if ! command -v tar >/dev/null 2>&1; then
        err "tar is required."
        return 1
    fi

    if ! command -v sha256sum >/dev/null 2>&1 &&
       ! command -v shasum >/dev/null 2>&1; then
        err "sha256sum or shasum is required."
        return 1
    fi
}

require_restore_tools

# --------------------------------------------------------
# Resolve backup directory
# --------------------------------------------------------

ORIGINAL_BACKUP_PATH="$BACKUP_PATH"

if [[ "$BACKUP_PATH" == /* ]]; then
    if [[ ! -d "$BACKUP_PATH" ]]; then
        err "Backup directory not found: $BACKUP_PATH"
        exit 1
    fi

    BACKUP_PATH="$(cd "$BACKUP_PATH" && pwd)"

elif [[ -d "$BACKUP_PATH" ]]; then
    BACKUP_PATH="$(cd "$BACKUP_PATH" && pwd)"

elif [[ -d "$REPO_ROOT/$BACKUP_PATH" ]]; then
    BACKUP_PATH="$(cd "$REPO_ROOT/$BACKUP_PATH" && pwd)"

else
    err "Backup directory not found."
    err "input=$ORIGINAL_BACKUP_PATH"
    err "cwd=$(pwd)/$ORIGINAL_BACKUP_PATH"
    err "repo=$REPO_ROOT/$ORIGINAL_BACKUP_PATH"
    exit 1
fi

BACKUP_NAME="$(basename "$BACKUP_PATH")"

log "Backup path: $BACKUP_PATH"

# --------------------------------------------------------
# Backup validation functions
# --------------------------------------------------------

verify_local_checksums() {
    local directory="$1"

    if [[ ! -f "$directory/SHA256SUMS" ]]; then
        return 1
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        (
            cd "$directory"
            sha256sum -c SHA256SUMS
        )
    else
        (
            cd "$directory"
            shasum -a 256 -c SHA256SUMS
        )
    fi
}

validate_sql_gzip_file() {
    local backup_file="$1"

    if [[ ! -s "$backup_file" ]]; then
        err "Backup file missing or empty: $backup_file"
        return 1
    fi

    if ! gzip -t "$backup_file"; then
        err "Invalid gzip file: $backup_file"
        return 1
    fi

    if ! gzip -dc "$backup_file" |
        awk '
            NR <= 50 && /PostgreSQL database dump/ {
                found = 1
            }

            END {
                exit(found ? 0 : 1)
            }
        '
    then
        err "Not a PostgreSQL plain SQL dump: $backup_file"
        return 1
    fi
}

# --------------------------------------------------------
# Validate backup metadata
# --------------------------------------------------------

for required_file in databases.tsv backup_info.txt SHA256SUMS; do
    if [[ ! -f "$BACKUP_PATH/$required_file" ]]; then
        err "$required_file is missing."
        exit 1
    fi
done

BACKUP_FORMAT="$(
    awk -F= '
        $1 == "backup_format" {
            print $2
            exit
        }
    ' "$BACKUP_PATH/backup_info.txt"
)"

if [[ "$BACKUP_FORMAT" != "postgresql_plain_sql_gzip" ]]; then
    err "Unsupported backup format: ${BACKUP_FORMAT:-unknown}"
    exit 1
fi

log "Checking backup checksums"

if ! verify_local_checksums "$BACKUP_PATH"; then
    err "Checksum verification failed."
    exit 1
fi

DATABASE_COUNT="$(
    tail -n +2 "$BACKUP_PATH/databases.tsv" |
        awk '
            NF > 0 {
                count++
            }

            END {
                print count + 0
            }
        '
)"

if [[ "$DATABASE_COUNT" -ne "$EXPECTED_DB_COUNT" ]]; then
    err "Database count mismatch: expected=$EXPECTED_DB_COUNT actual=$DATABASE_COUNT"
    exit 1
fi

while IFS=$'\t' read -r \
    container \
    postgres_user \
    postgres_database \
    backup_file \
    backup_format
do
    if [[ "$container" == "container" || -z "$container" ]]; then
        continue
    fi

    if [[ -z "$postgres_user" || -z "$postgres_database" ]]; then
        err "Invalid databases.tsv row: $container"
        exit 1
    fi

    backup_file="${backup_file:-${container}.sql.gz}"

    if [[ "$backup_file" != *.sql.gz ]]; then
        err "Unsupported backup extension: $backup_file"
        exit 1
    fi

    if [[ -n "$backup_format" && "$backup_format" != "plain_sql_gzip" ]]; then
        err "Unsupported DB format: $backup_format"
        exit 1
    fi

    validate_sql_gzip_file "$BACKUP_PATH/$backup_file" || exit 1
done < "$BACKUP_PATH/databases.tsv"

ok "Local backup validation complete: DB count=$DATABASE_COUNT"

# --------------------------------------------------------
# Database helper functions
# --------------------------------------------------------

validate_database_name() {
    local database="$1"

    if [[ "$database" == "postgres" ||
          "$database" == "template0" ||
          "$database" == "template1" ]]; then
        err "System database cannot be dropped: $database"
        return 1
    fi
}

terminate_database_connections() {
    local docker_cmd="$1"
    local container="$2"
    local user="$3"
    local database="$4"

    printf '%s\n' \
        "SELECT pg_terminate_backend(pid)" \
        "FROM pg_stat_activity" \
        "WHERE datname = current_setting('restore.target_db')" \
        "  AND pid <> pg_backend_pid();" |
        $docker_cmd exec -i \
            -e PGOPTIONS="-c restore.target_db=$database" \
            "$container" \
            psql \
            --username="$user" \
            --dbname=postgres \
            --set=ON_ERROR_STOP=1 \
            >/dev/null
}

# --------------------------------------------------------
# Local restore
# --------------------------------------------------------

restore_local() {
    require_docker

    if ! docker info >/dev/null 2>&1; then
        err "Cannot access local Docker daemon."
        return 1
    fi

    local success=0
    local warnings=0

    local container
    local user
    local database
    local file
    local format
    local path
    local status
    local log_file
    local rc
    local errors
    local pipeline_status

    if [[ "$FORCE_MODE" == true ]]; then
        warn "Local force restore: existing databases will be recreated."
    fi

    while IFS=$'\t' read -r container user database file format; do
        if [[ "$container" == "container" || -z "$container" ]]; then
            continue
        fi

        file="${file:-${container}.sql.gz}"
        path="$BACKUP_PATH/$file"

        log "Local restore target: container=$container database=$database file=$file"

        if ! docker inspect "$container" >/dev/null 2>&1; then
            err "Container not found: $container"
            return 1
        fi

        status="$(
            docker inspect \
                --format '{{.State.Status}}' \
                "$container" \
                2>/dev/null || true
        )"

        if [[ "$status" != "running" ]]; then
            err "Container is not running: $container ($status)"
            return 1
        fi

        validate_sql_gzip_file "$path" || return 1

        if [[ "$FORCE_MODE" == true ]]; then
            validate_database_name "$database" || return 1

            warn "Terminating local DB connections: $database"

            if ! terminate_database_connections \
                docker \
                "$container" \
                "$user" \
                "$database"
            then
                err "Failed to terminate DB connections: container=$container database=$database"
                return 1
            fi

            warn "Dropping local DB: $database"

            if ! docker exec "$container" \
                dropdb \
                --username="$user" \
                --if-exists \
                "$database"
            then
                err "Failed to drop local database: $database"
                return 1
            fi

            log "Creating local DB: $database"

            if ! docker exec "$container" \
                createdb \
                --username="$user" \
                --owner="$user" \
                "$database"
            then
                err "Failed to create local database: $database"
                return 1
            fi

            log "Restoring local DB: $database"

            if ! gzip -dc "$path" |
                docker exec -i "$container" \
                    psql \
                    --username="$user" \
                    --dbname="$database" \
                    --set=ON_ERROR_STOP=1
            then
                err "Failed to restore local database: $database"
                return 1
            fi

            success=$((success + 1))

            ok "Local force restore complete: $container"

        else
            log_file="/tmp/${container}_restore_$$.log"
            rm -f "$log_file"

            set +e

            gzip -dc "$path" |
                docker exec -i "$container" \
                    psql \
                    --username="$user" \
                    --dbname="$database" \
                    --set=ON_ERROR_STOP=0 \
                    2>&1 |
                tee "$log_file"

            pipeline_status=("${PIPESTATUS[@]}")
            rc="${pipeline_status[1]}"

            set -e

            errors="$(
                grep -cE \
                    '(^ERROR:|^psql:.*ERROR:|^psql:.*FATAL:)' \
                    "$log_file" \
                    2>/dev/null || true
            )"

            rm -f "$log_file"

            if [[ "$rc" -eq 0 && "$errors" -eq 0 ]]; then
                success=$((success + 1))
                ok "Local SQL restore complete: $container"
            else
                warnings=$((warnings + 1))
                warn "SQL conflicts: container=$container exit=$rc errors=$errors"
            fi
        fi
    done < "$BACKUP_PATH/databases.tsv"

    log "Local result: success=$success warnings=$warnings"

    if [[ "$FORCE_MODE" == true && "$success" -ne "$DATABASE_COUNT" ]]; then
        err "Local force restore count mismatch: expected=$DATABASE_COUNT actual=$success"
        return 1
    fi
}

# --------------------------------------------------------
# Execute local restore
# --------------------------------------------------------

if [[ "$LOCAL_MODE" == true ]]; then
    restore_local
    ok "Local restore completed: $BACKUP_PATH"
    exit 0
fi

# --------------------------------------------------------
# Remote restore requirements
# --------------------------------------------------------

require_aws

: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_PREFIX:?BACKUP_S3_PREFIX is required}"

find_restore_instance() {
    aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names "$ASG_NAME" \
        --region "$AWS_REGION" \
        --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService'].InstanceId | [0]" \
        --output text
}

validate_restore_instance() {
    local instance_id="$1"
    local instance_state
    local ssm_status

    instance_state="$(
        aws ec2 describe-instances \
            --instance-ids "$instance_id" \
            --region "$AWS_REGION" \
            --query 'Reservations[0].Instances[0].State.Name' \
            --output text \
            2>/dev/null || true
    )"

    ssm_status="$(
        aws ssm describe-instance-information \
            --region "$AWS_REGION" \
            --filters "Key=InstanceIds,Values=$instance_id" \
            --query 'InstanceInformationList[0].PingStatus' \
            --output text \
            2>/dev/null || true
    )"

    if [[ "$instance_state" != "running" ]]; then
        err "Instance is not running: $instance_id ($instance_state)"
        return 1
    fi

    if [[ "$ssm_status" != "Online" ]]; then
        err "Instance is not SSM Online: $instance_id ($ssm_status)"
        return 1
    fi
}

# --------------------------------------------------------
# Select remote instance
# --------------------------------------------------------

if [[ -z "$TARGET" ]]; then
    TARGET="$(find_restore_instance)"

    if [[ -z "$TARGET" || "$TARGET" == "None" ]]; then
        err "No InService instance found."
        exit 1
    fi
fi

validate_restore_instance "$TARGET"

ok "Remote restore target: $TARGET"

# --------------------------------------------------------
# Create archive and upload to S3
# --------------------------------------------------------

LOCAL_ARCHIVE="/tmp/${BACKUP_NAME}_restore_$$.tar.gz"
S3_OBJECT_NAME="${BACKUP_NAME}_restore_$(date +%Y%m%d%H%M%S)_$$.tar.gz"
S3_URI="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${TARGET}/${S3_OBJECT_NAME}"

S3_UPLOADED=false
RESTORE_SUCCEEDED=false

cleanup_local() {
    local rc=$?

    rm -f "$LOCAL_ARCHIVE"

    if [[ "$RESTORE_SUCCEEDED" == true &&
          "$S3_UPLOADED" == true ]]; then
        aws s3 rm \
            "$S3_URI" \
            --region "$AWS_REGION" \
            --only-show-errors \
            >/dev/null 2>&1 || true
    fi

    return "$rc"
}

trap cleanup_local EXIT

if command -v xattr >/dev/null 2>&1; then
    xattr -cr "$BACKUP_PATH" >/dev/null 2>&1 || true
fi

COPYFILE_DISABLE=1 tar \
    -C "$(dirname "$BACKUP_PATH")" \
    -czf "$LOCAL_ARCHIVE" \
    "$BACKUP_NAME"

if [[ ! -s "$LOCAL_ARCHIVE" ]]; then
    err "Archive creation failed."
    exit 1
fi

log "Uploading restore archive: $S3_URI"

aws s3 cp \
    "$LOCAL_ARCHIVE" \
    "$S3_URI" \
    --region "$AWS_REGION" \
    --only-show-errors

S3_UPLOADED=true

ok "Restore archive upload completed"

# --------------------------------------------------------
# Remote restore script
# --------------------------------------------------------

REMOTE_SCRIPT=$(cat <<EOF
#!/usr/bin/env bash

set -euo pipefail

FORCE_MODE="$FORCE_MODE"
BACKUP_NAME="$BACKUP_NAME"
S3_URI="$S3_URI"
AWS_REGION="$AWS_REGION"
EXPECTED_DB_COUNT="$EXPECTED_DB_COUNT"

REMOTE_ARCHIVE="/tmp/\${BACKUP_NAME}_restore_\$\$.tar.gz"
REMOTE_ROOT="/tmp/\${BACKUP_NAME}_restore_\$\$"
BACKUP_DIR="\${REMOTE_ROOT}/\${BACKUP_NAME}"

if command -v sudo >/dev/null 2>&1 &&
   sudo -n true >/dev/null 2>&1; then
    DOCKER="sudo docker"
else
    DOCKER="docker"
fi

cleanup() {
    local rc=\$?

    rm -f "\$REMOTE_ARCHIVE"
    rm -rf "\$REMOTE_ROOT"

    exit "\$rc"
}

trap cleanup EXIT

if ! \$DOCKER info >/dev/null 2>&1; then
    echo "[ERROR] Docker access failed"
    exit 1
fi

for required_command in aws gzip sha256sum tar; do
    if ! command -v "\$required_command" >/dev/null 2>&1; then
        echo "[ERROR] Missing command: \$required_command"
        exit 1
    fi
done

mkdir -p "\$REMOTE_ROOT"

echo "[INFO] Downloading restore archive"
echo "[INFO] S3 URI: \$S3_URI"

aws s3 cp \
    "\$S3_URI" \
    "\$REMOTE_ARCHIVE" \
    --region "\$AWS_REGION" \
    --only-show-errors

if [[ ! -s "\$REMOTE_ARCHIVE" ]]; then
    echo "[ERROR] Downloaded archive is missing or empty"
    exit 1
fi

tar -xzf "\$REMOTE_ARCHIVE" -C "\$REMOTE_ROOT"

if [[ ! -f "\$BACKUP_DIR/databases.tsv" ||
      ! -f "\$BACKUP_DIR/SHA256SUMS" ||
      ! -f "\$BACKUP_DIR/backup_info.txt" ]]; then
    echo "[ERROR] Invalid backup directory"
    echo "[ERROR] Backup path: \$BACKUP_DIR"
    exit 1
fi

echo "[INFO] Verifying backup checksums"

(
    cd "\$BACKUP_DIR"
    sha256sum -c SHA256SUMS
)

ACTUAL_DB_COUNT=\$(
    tail -n +2 "\$BACKUP_DIR/databases.tsv" |
        awk '
            NF > 0 {
                count++
            }

            END {
                print count + 0
            }
        '
)

if [[ "\$ACTUAL_DB_COUNT" -ne "\$EXPECTED_DB_COUNT" ]]; then
    echo "[ERROR] Database count mismatch: expected=\$EXPECTED_DB_COUNT actual=\$ACTUAL_DB_COUNT"
    exit 1
fi

SUCCESS_COUNT=0
WARNING_COUNT=0

while IFS=\$'\t' read -r container user database file format; do
    if [[ "\$container" == "container" || -z "\$container" ]]; then
        continue
    fi

    file="\${file:-\${container}.sql.gz}"
    path="\$BACKUP_DIR/\$file"

    echo "[INFO] Remote target: container=\$container database=\$database file=\$file"

    if ! \$DOCKER inspect "\$container" >/dev/null 2>&1; then
        echo "[ERROR] Container not found: \$container"
        exit 1
    fi

    status=\$(
        \$DOCKER inspect \
            --format '{{.State.Status}}' \
            "\$container" \
            2>/dev/null || true
    )

    if [[ "\$status" != "running" ]]; then
        echo "[ERROR] Container not running: \$container status=\$status"
        exit 1
    fi

    if [[ ! -s "\$path" ]]; then
        echo "[ERROR] Backup file missing or empty: \$path"
        exit 1
    fi

    if ! gzip -t "\$path"; then
        echo "[ERROR] Bad gzip: \$path"
        exit 1
    fi

    if [[ "\$FORCE_MODE" == true ]]; then
        if [[ "\$database" == "postgres" ||
              "\$database" == "template0" ||
              "\$database" == "template1" ]]; then
            echo "[ERROR] Protected database cannot be dropped: \$database"
            exit 1
        fi

        echo "[WARN] Terminating DB connections: \$database"

        printf '%s\n' \
            "SELECT pg_terminate_backend(pid)" \
            "FROM pg_stat_activity" \
            "WHERE datname = current_setting('restore.target_db')" \
            "  AND pid <> pg_backend_pid();" |
            \$DOCKER exec -i \
                -e PGOPTIONS="-c restore.target_db=\$database" \
                "\$container" \
                psql \
                --username="\$user" \
                --dbname=postgres \
                --set=ON_ERROR_STOP=1 \
                >/dev/null

        echo "[WARN] Dropping database: \$database"

        \$DOCKER exec "\$container" \
            dropdb \
            --username="\$user" \
            --if-exists \
            "\$database"

        echo "[INFO] Creating database: \$database"

        \$DOCKER exec "\$container" \
            createdb \
            --username="\$user" \
            --owner="\$user" \
            "\$database"

        echo "[INFO] Restoring database: \$database"

        gzip -dc "\$path" |
            \$DOCKER exec -i "\$container" \
                psql \
                --username="\$user" \
                --dbname="\$database" \
                --set=ON_ERROR_STOP=1

        SUCCESS_COUNT=\$((SUCCESS_COUNT + 1))

        echo "[OK] Remote force restore complete: \$container"

    else
        log_file="/tmp/\${container}_restore_\$\$.log"

        rm -f "\$log_file"

        set +e

        gzip -dc "\$path" |
            \$DOCKER exec -i "\$container" \
                psql \
                --username="\$user" \
                --dbname="\$database" \
                --set=ON_ERROR_STOP=0 \
                2>&1 |
            tee "\$log_file"

        pipeline_status=("\${PIPESTATUS[@]}")
        rc="\${pipeline_status[1]}"

        set -e

        errors=\$(
            grep -cE \
                '(^ERROR:|^psql:.*ERROR:|^psql:.*FATAL:)' \
                "\$log_file" \
                2>/dev/null || true
        )

        rm -f "\$log_file"

        if [[ "\$rc" -eq 0 && "\$errors" -eq 0 ]]; then
            SUCCESS_COUNT=\$((SUCCESS_COUNT + 1))
            echo "[OK] Remote SQL restore complete: \$container"
        else
            WARNING_COUNT=\$((WARNING_COUNT + 1))
            echo "[WARN] SQL conflicts: container=\$container exit=\$rc errors=\$errors"
        fi
    fi

done < "\$BACKUP_DIR/databases.tsv"

echo "[INFO] Remote result: success=\$SUCCESS_COUNT warnings=\$WARNING_COUNT"

if [[ "\$FORCE_MODE" == true &&
      "\$SUCCESS_COUNT" -ne "\$EXPECTED_DB_COUNT" ]]; then
    echo "[ERROR] Remote force restore count mismatch"
    echo "[ERROR] expected=\$EXPECTED_DB_COUNT actual=\$SUCCESS_COUNT"
    exit 1
fi

echo "[OK] Remote restore script completed"
EOF
)

# --------------------------------------------------------
# Send remote script through SSM
# --------------------------------------------------------

REMOTE_SCRIPT_B64="$(
    printf '%s' "$REMOTE_SCRIPT" |
        base64 |
        tr -d '\n'
)"

REMOTE_COMMAND="echo '$REMOTE_SCRIPT_B64' | base64 -d | bash"

# Python을 사용해 SSM parameters JSON을 안전하게 생성한다.
PARAMETERS_JSON="$(
    REMOTE_COMMAND="$REMOTE_COMMAND" python3 <<'PY'
import json
import os

print(json.dumps({
    "commands": [
        os.environ["REMOTE_COMMAND"]
    ]
}))
PY
)"

CMD_ID="$(
    aws ssm send-command \
        --instance-ids "$TARGET" \
        --document-name "AWS-RunShellScript" \
        --parameters "$PARAMETERS_JSON" \
        --region "$AWS_REGION" \
        --query 'Command.CommandId' \
        --output text
)"

log "SSM CommandId=$CMD_ID"

aws ssm wait command-executed \
    --command-id "$CMD_ID" \
    --instance-id "$TARGET" \
    --region "$AWS_REGION" \
    2>/dev/null || true

# --------------------------------------------------------
# Read SSM result
# --------------------------------------------------------

INVOCATION="$(
    aws ssm get-command-invocation \
        --command-id "$CMD_ID" \
        --instance-id "$TARGET" \
        --region "$AWS_REGION" \
        --output json
)"

STATUS="$(
    printf '%s' "$INVOCATION" |
        python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("Status", "Unknown"))
'
)"

STDOUT_CONTENT="$(
    printf '%s' "$INVOCATION" |
        python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("StandardOutputContent", ""))
'
)"

STDERR_CONTENT="$(
    printf '%s' "$INVOCATION" |
        python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("StandardErrorContent", ""))
'
)"

printf '\n--- RESTORE STDOUT ---\n%s\n' "$STDOUT_CONTENT"

if [[ -n "$STDERR_CONTENT" && "$STDERR_CONTENT" != "None" ]]; then
    printf '\n--- RESTORE STDERR ---\n%s\n' "$STDERR_CONTENT"
fi

if [[ "$STATUS" != "Success" ]]; then
    err "Restore failed: Status=$STATUS"
    err "S3 retained: $S3_URI"
    exit 1
fi

RESTORE_SUCCEEDED=true

# --------------------------------------------------------
# Remove temporary S3 restore archive
# --------------------------------------------------------

if aws s3 rm \
    "$S3_URI" \
    --region "$AWS_REGION" \
    --only-show-errors
then
    S3_UPLOADED=false
    ok "Temporary S3 archive deleted"
else
    warn "Failed to delete temporary S3 archive"
    warn "Delete manually: $S3_URI"
fi

ok "Remote restore completed: instance=$TARGET backup=$BACKUP_PATH"