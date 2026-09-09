#!/usr/bin/env bash
#
# PostgreSQL Docker 컨테이너 백업
#
# 백업 형식:
#   PostgreSQL plain SQL + gzip
#
# 생성 결과:
#   backup/db_backup_YYYYMMDDHHMMSS/
#     ai-chat-service-pg.sql.gz
#     event-receiver-pg.sql.gz
#     action-runner-pg.sql.gz
#     report-manager-pg.sql.gz
#     event-analyzer-pg.sql.gz
#     config-manager-pg.sql.gz
#     databases.tsv
#     backup_info.txt
#     SHA256SUMS
#
# 원격 EC2 백업:
#   1. ASG에서 InService 인스턴스 조회
#   2. SSM Run Command로 EC2에서 각 PostgreSQL DB 백업
#   3. 각 DB를 plain SQL + gzip 형식으로 생성
#   4. 전체 백업 디렉터리를 tar.gz로 압축
#   5. S3 임시 경로에 업로드
#   6. 로컬 backup/db_backup_YYYYMMDDHHMMSS/로 다운로드
#   7. 체크섬 검증
#   8. S3 및 EC2 임시 파일 삭제
#
# 로컬 Docker 백업:
#   1. 로컬 Docker에서 각 PostgreSQL DB 백업
#   2. 각 DB를 plain SQL + gzip 형식으로 생성
#   3. 로컬 backup/db_backup_YYYYMMDDHHMMSS/에 직접 저장
#   4. 체크섬 검증
#
# 사용법:
#
#   원격 EC2 자동 선택:
#     ./scripts/aws/backup.sh
#
#   특정 EC2 인스턴스:
#     ./scripts/aws/backup.sh i-00db45f6e071ee5c8
#
#   로컬 Docker:
#     ./scripts/aws/backup.sh -local
#
# deploy.sh에서 호출:
#
#   source "$SCRIPT_DIR/backup.sh"
#   backup_databases_to_local "$INSTANCE_ID"
#

set -euo pipefail

BACKUP_SCRIPT_DIR="$(
    cd "$(dirname "${BASH_SOURCE[0]}")" \
        && pwd
)"

source "$BACKUP_SCRIPT_DIR/config.sh"

BACKUP_REPO_ROOT="$(
    cd "$BACKUP_SCRIPT_DIR/../.." \
        && pwd
)"

DB_CONTAINERS=(
    "ai-chat-service-pg"
    "event-receiver-pg"
    "action-runner-pg"
    "report-manager-pg"
    "event-analyzer-pg"
    "config-manager-pg"
)

# =========================================================
# 사용법
# =========================================================

usage() {
    echo "사용법:"
    echo
    echo "  원격 EC2 자동 선택:"
    echo "    $0"
    echo
    echo "  특정 EC2 인스턴스:"
    echo "    $0 i-xxxxxxxxxxxxxxxxx"
    echo
    echo "  로컬 Docker:"
    echo "    $0 -local"
    echo
    echo "예:"
    echo "  $0"
    echo "  $0 i-00db45f6e071ee5c8"
    echo "  $0 -local"
}

# =========================================================
# 공통 로컬 명령 확인
# =========================================================

require_local_backup_tools() {
    if ! command -v tar >/dev/null 2>&1; then
        err "로컬에 tar 명령이 필요합니다."
        return 1
    fi

    if ! command -v gzip >/dev/null 2>&1; then
        err "로컬에 gzip 명령이 필요합니다."
        return 1
    fi

    if ! command -v sha256sum >/dev/null 2>&1 \
        && ! command -v shasum >/dev/null 2>&1; then

        err "로컬에 sha256sum 또는 shasum 명령이 필요합니다."
        return 1
    fi
}

# =========================================================
# 원격 백업 설정 확인
# =========================================================

require_backup_config() {
    if [[ -z "${BACKUP_S3_BUCKET:-}" ]]; then
        err "BACKUP_S3_BUCKET 값이 설정되지 않았습니다."
        err "config.sh에 BACKUP_S3_BUCKET을 설정하세요."
        return 1
    fi

    if [[ -z "${BACKUP_S3_PREFIX:-}" ]]; then
        err "BACKUP_S3_PREFIX 값이 설정되지 않았습니다."
        err "config.sh에 BACKUP_S3_PREFIX를 설정하세요."
        return 1
    fi

    require_local_backup_tools
}

# =========================================================
# 로컬 SHA256 체크섬 생성
# =========================================================

create_local_checksums() {
    local backup_directory="$1"

    if command -v sha256sum >/dev/null 2>&1; then
        (
            cd "$backup_directory"
            sha256sum ./*.sql.gz > SHA256SUMS
        )
        return
    fi

    if command -v shasum >/dev/null 2>&1; then
        (
            cd "$backup_directory"
            shasum -a 256 ./*.sql.gz > SHA256SUMS
        )
        return
    fi

    err "sha256sum 또는 shasum 명령을 찾지 못했습니다."
    return 1
}

# =========================================================
# 로컬 SHA256 체크섬 검사
# =========================================================

verify_local_checksums() {
    local backup_directory="$1"

    if [[ ! -f "$backup_directory/SHA256SUMS" ]]; then
        err "SHA256SUMS 파일이 없습니다."
        err "backup_directory=$backup_directory"
        return 1
    fi

    if command -v sha256sum >/dev/null 2>&1; then
        (
            cd "$backup_directory"
            sha256sum -c SHA256SUMS
        )
        return
    fi

    if command -v shasum >/dev/null 2>&1; then
        (
            cd "$backup_directory"
            shasum -a 256 -c SHA256SUMS
        )
        return
    fi

    err "sha256sum 또는 shasum 명령을 찾지 못했습니다."
    return 1
}

# =========================================================
# SQL gzip 파일 검증
# =========================================================

validate_sql_gzip_file() {
    local sql_gzip_file="$1"

    if [[ ! -s "$sql_gzip_file" ]]; then
        err "SQL 백업 파일이 없거나 비어 있습니다."
        err "file=$sql_gzip_file"
        return 1
    fi

    if ! gzip -t "$sql_gzip_file"; then
        err "gzip 무결성 검사에 실패했습니다."
        err "file=$sql_gzip_file"
        return 1
    fi

    # head를 사용하면 set -o pipefail 환경에서 gzip이 SIGPIPE로
    # 실패 처리될 수 있으므로 awk가 전체 스트림을 소비하도록 한다.
    if ! gzip -dc "$sql_gzip_file" \
        | awk '
            NR <= 30 && /PostgreSQL database dump/ {
                found = 1
            }
            END {
                exit(found ? 0 : 1)
            }
        '; then

        err "PostgreSQL plain SQL 백업으로 확인되지 않습니다."
        err "file=$sql_gzip_file"

        echo "[INFO] SQL 백업 파일의 처음 10줄:" >&2

        gzip -dc "$sql_gzip_file" \
            | sed -n '1,10p' \
            >&2 || true

        return 1
    fi

    return 0
}

# =========================================================
# 백업 디렉터리 검증
# =========================================================

validate_backup_directory() {
    local backup_directory="$1"
    local expected_count="${#DB_CONTAINERS[@]}"
    local actual_count
    local metadata_count
    local sql_gzip_file

    if [[ ! -d "$backup_directory" ]]; then
        err "백업 디렉터리를 찾지 못했습니다."
        err "path=$backup_directory"
        return 1
    fi

    if [[ ! -f "$backup_directory/databases.tsv" ]]; then
        err "databases.tsv 파일이 없습니다."
        err "path=$backup_directory"
        return 1
    fi

    if [[ ! -f "$backup_directory/backup_info.txt" ]]; then
        err "backup_info.txt 파일이 없습니다."
        err "path=$backup_directory"
        return 1
    fi

    if [[ ! -f "$backup_directory/SHA256SUMS" ]]; then
        err "SHA256SUMS 파일이 없습니다."
        err "path=$backup_directory"
        return 1
    fi

    actual_count="$(
        find "$backup_directory" \
            -maxdepth 1 \
            -type f \
            -name '*.sql.gz' \
            | wc -l \
            | tr -d ' '
    )"

    metadata_count="$(
        tail -n +2 "$backup_directory/databases.tsv" \
            | awk 'NF > 0 { count++ } END { print count + 0 }'
    )"

    if [[ "$actual_count" -ne "$expected_count" ]]; then
        err "백업 SQL 파일 개수가 일치하지 않습니다."
        err "expected=$expected_count"
        err "actual=$actual_count"
        return 1
    fi

    if [[ "$metadata_count" -ne "$expected_count" ]]; then
        err "databases.tsv의 DB 개수가 일치하지 않습니다."
        err "expected=$expected_count"
        err "actual=$metadata_count"
        return 1
    fi

    for sql_gzip_file in "$backup_directory"/*.sql.gz; do
        if ! validate_sql_gzip_file "$sql_gzip_file"; then
            return 1
        fi
    done

    if ! verify_local_checksums "$backup_directory"; then
        err "백업 SQL 파일 체크섬 검사에 실패했습니다."
        return 1
    fi

    return 0
}

# =========================================================
# 로컬 Docker PostgreSQL 백업
#
# AWS, SSM, S3를 사용하지 않는다.
# =========================================================

backup_local_databases() {
    local local_backup_root="${1:-${BACKUP_REPO_ROOT}/backup}"

    local timestamp
    local backup_name
    local final_backup_directory
    local temp_backup_directory

    local container
    local container_status
    local postgres_user
    local postgres_database
    local postgres_version
    local postgres_server_version
    local backup_file_name
    local backup_file_path
    local backup_size
    local backup_count

    require_docker
    require_local_backup_tools

    if ! docker info >/dev/null 2>&1; then
        err "로컬 Docker daemon에 접근할 수 없습니다."
        err "Docker Desktop 또는 Docker daemon 실행 상태를 확인하세요."
        return 1
    fi

    timestamp="$(date +%Y%m%d%H%M%S)"
    backup_name="db_backup_${timestamp}"

    final_backup_directory="${local_backup_root}/${backup_name}"
    temp_backup_directory="${local_backup_root}/.${backup_name}.tmp"

    mkdir -p "$local_backup_root"

    if [[ -e "$final_backup_directory" \
        || -e "$temp_backup_directory" ]]; then

        err "동일한 백업 경로가 이미 존재합니다."
        err "path=$final_backup_directory"
        return 1
    fi

    rm -rf "$temp_backup_directory"
    mkdir -p "$temp_backup_directory"

    cleanup_failed_local_backup() {
        local exit_code=$?

        if [[ $exit_code -ne 0 ]]; then
            err "로컬 DB 백업에 실패했습니다."

            if [[ -d "$temp_backup_directory" ]]; then
                warn "불완전한 임시 백업을 삭제합니다."
                warn "path=$temp_backup_directory"

                rm -rf "$temp_backup_directory"
            fi
        fi

        return "$exit_code"
    }

    trap cleanup_failed_local_backup RETURN

    printf \
        'container\tpostgres_user\tpostgres_database\tbackup_file\tbackup_format\n' \
        > "$temp_backup_directory/databases.tsv"

    {
        echo "backup_timestamp=$timestamp"
        echo "backup_started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "backup_host=$(hostname)"
        echo "backup_source=local_docker"
        echo "backup_format=postgresql_plain_sql_gzip"
        echo "container_count=${#DB_CONTAINERS[@]}"
    } > "$temp_backup_directory/backup_info.txt"

    echo
    log "로컬 PostgreSQL 백업 시작"
    log "백업 이름: $backup_name"
    log "백업 경로: $final_backup_directory"
    log "백업 형식: plain SQL + gzip"

    for container in "${DB_CONTAINERS[@]}"; do
        echo
        log "로컬 DB 컨테이너 확인: $container"

        if ! docker inspect "$container" >/dev/null 2>&1; then
            err "로컬 DB 컨테이너를 찾지 못했습니다."
            err "container=$container"
            err "현재 Docker 컨테이너 목록:"

            docker ps \
                --format '  {{.Names}}' \
                >&2 || true

            return 1
        fi

        container_status="$(
            docker inspect \
                --format '{{.State.Status}}' \
                "$container" \
                2>/dev/null || true
        )"

        if [[ "$container_status" != "running" ]]; then
            err "로컬 DB 컨테이너가 실행 중이 아닙니다."
            err "container=$container"
            err "status=${container_status:-unknown}"
            return 1
        fi

        postgres_user="$(
            docker exec "$container" \
                sh -c 'printf "%s" "${POSTGRES_USER:-postgres}"'
        )"

        postgres_database="$(
            docker exec "$container" \
                sh -c 'printf "%s" "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"'
        )"

        if [[ -z "$postgres_user" ]]; then
            postgres_user="postgres"
        fi

        if [[ -z "$postgres_database" ]]; then
            postgres_database="$postgres_user"
        fi

        postgres_version="$(
            docker exec "$container" \
                pg_dump --version \
                2>/dev/null || true
        )"

        postgres_server_version="$(
            docker exec "$container" \
                postgres --version \
                2>/dev/null || true
        )"

        log "  container=$container"
        log "  postgres_user=$postgres_user"
        log "  postgres_database=$postgres_database"
        log "  postgres_server_version=${postgres_server_version:-unknown}"
        log "  pg_dump_version=${postgres_version:-unknown}"

        if ! docker exec "$container" \
            pg_isready \
                --username="$postgres_user" \
                --dbname="$postgres_database" \
                >/dev/null 2>&1; then

            err "로컬 PostgreSQL 연결 확인 실패"
            err "container=$container"
            err "database=$postgres_database"
            return 1
        fi

        backup_file_name="${container}.sql.gz"
        backup_file_path="${temp_backup_directory}/${backup_file_name}"

        log "plain SQL gzip 백업 생성: $backup_file_name"

        if ! docker exec "$container" \
            pg_dump \
                --format=plain \
                --no-owner \
                --no-privileges \
                --username="$postgres_user" \
                --dbname="$postgres_database" \
            | gzip -c \
            > "$backup_file_path"; then

            err "로컬 PostgreSQL 백업 생성 실패"
            err "container=$container"

            rm -f "$backup_file_path"
            return 1
        fi

        if ! validate_sql_gzip_file "$backup_file_path"; then
            err "생성된 SQL 백업 파일 검증 실패"
            err "container=$container"
            return 1
        fi

        backup_size="$(
            du -h "$backup_file_path" \
                | awk '{print $1}'
        )"

        printf '%s\t%s\t%s\t%s\t%s\n' \
            "$container" \
            "$postgres_user" \
            "$postgres_database" \
            "$backup_file_name" \
            "plain_sql_gzip" \
            >> "$temp_backup_directory/databases.tsv"

        {
            echo
            echo "[$container]"
            echo "postgres_user=$postgres_user"
            echo "postgres_database=$postgres_database"
            echo "postgres_server_version=$postgres_server_version"
            echo "pg_dump_version=$postgres_version"
            echo "backup_file=$backup_file_name"
            echo "backup_format=plain_sql_gzip"
            echo "backup_size=$backup_size"
        } >> "$temp_backup_directory/backup_info.txt"

        ok "백업 완료: $container ($backup_size)"
    done

    echo
    log "SHA256 체크섬 생성"

    if ! create_local_checksums "$temp_backup_directory"; then
        err "SHA256 체크섬 생성 실패"
        return 1
    fi

    {
        echo
        echo "backup_finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "backup_status=success"
    } >> "$temp_backup_directory/backup_info.txt"

    log "로컬 SQL 백업 파일 체크섬 검사"

    if ! verify_local_checksums "$temp_backup_directory"; then
        err "로컬 SQL 백업 파일 체크섬 검사 실패"
        return 1
    fi

    backup_count="$(
        find "$temp_backup_directory" \
            -maxdepth 1 \
            -type f \
            -name '*.sql.gz' \
            | wc -l \
            | tr -d ' '
    )"

    if [[ "$backup_count" -ne "${#DB_CONTAINERS[@]}" ]]; then
        err "백업 SQL 파일 개수가 일치하지 않습니다."
        err "expected=${#DB_CONTAINERS[@]}"
        err "actual=$backup_count"
        return 1
    fi

    # macOS 확장 속성이 이후 tar에 포함되지 않도록 제거한다.
    if command -v xattr >/dev/null 2>&1; then
        xattr -cr "$temp_backup_directory" >/dev/null 2>&1 || true
    fi

    # 모든 백업과 검증이 성공한 경우에만 최종 디렉터리로 이동한다.
    mv "$temp_backup_directory" "$final_backup_directory"

    trap - RETURN

    echo
    ok "로컬 DB 백업 완료"
    ok "백업 경로: $final_backup_directory"
    ok "SQL 백업 파일 수: $backup_count"

    echo
    ls -lh "$final_backup_directory"

    echo
    du -sh "$final_backup_directory"
}

# =========================================================
# 원격 백업 대상 인스턴스 조회
# =========================================================

find_backup_instance() {
    local target

    target="$(
        aws autoscaling describe-auto-scaling-groups \
            --auto-scaling-group-names "$ASG_NAME" \
            --region "$AWS_REGION" \
            --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService'].InstanceId | [0]" \
            --output text
    )"

    if [[ -z "$target" || "$target" == "None" ]]; then
        err "ASG에서 InService 인스턴스를 찾지 못했습니다."
        err "ASG_NAME=$ASG_NAME"
        err "AWS_REGION=$AWS_REGION"
        return 1
    fi

    printf '%s\n' "$target"
}

# =========================================================
# 원격 인스턴스 상태 확인
# =========================================================

validate_backup_instance() {
    local instance_id="$1"
    local instance_state
    local ssm_status

    instance_state="$(
        aws ec2 describe-instances \
            --instance-ids "$instance_id" \
            --region "$AWS_REGION" \
            --query "Reservations[0].Instances[0].State.Name" \
            --output text \
            2>/dev/null || true
    )"

    ssm_status="$(
        aws ssm describe-instance-information \
            --region "$AWS_REGION" \
            --filters "Key=InstanceIds,Values=$instance_id" \
            --query "InstanceInformationList[0].PingStatus" \
            --output text \
            2>/dev/null || true
    )"

    log "대상 인스턴스 상태"
    log "  instance=$instance_id"
    log "  ec2_state=${instance_state:-unknown}"
    log "  ssm_status=${ssm_status:-unknown}"

    if [[ "$instance_state" != "running" ]]; then
        err "대상 인스턴스가 running 상태가 아닙니다."
        return 1
    fi

    if [[ "$ssm_status" != "Online" ]]; then
        err "대상 인스턴스가 SSM Online 상태가 아닙니다."
        return 1
    fi
}

# =========================================================
# 원격 백업 스크립트 생성
# =========================================================

build_remote_backup_script() {
    local timestamp="$1"
    local s3_uri="$2"
    local container_lines=""
    local container

    for container in "${DB_CONTAINERS[@]}"; do
        container_lines+="    \"${container}\""$'\n'
    done

    cat <<EOF
#!/usr/bin/env bash

set -euo pipefail

TIMESTAMP="${timestamp}"
BACKUP_NAME="db_backup_\${TIMESTAMP}"

REMOTE_BACKUP_DIR="/tmp/\${BACKUP_NAME}"
REMOTE_ARCHIVE="/tmp/\${BACKUP_NAME}.tar.gz"

S3_URI="${s3_uri}"
AWS_REGION="${AWS_REGION}"

DB_CONTAINERS=(
${container_lines})

SUDO=""

if command -v sudo >/dev/null 2>&1 \
    && sudo -n true >/dev/null 2>&1; then

    SUDO="sudo"
fi

if [[ -n "\$SUDO" ]]; then
    DOCKER="sudo docker"
else
    DOCKER="docker"
fi

cleanup() {
    local exit_code=\$?

    rm -rf "\$REMOTE_BACKUP_DIR"
    rm -f "\$REMOTE_ARCHIVE"

    if [[ \$exit_code -ne 0 ]]; then
        echo "[ERROR] DB 백업 실패"
    fi

    exit "\$exit_code"
}

trap cleanup EXIT

echo "[INFO] 원격 PostgreSQL 백업 시작"
echo "[INFO] 백업 이름: \$BACKUP_NAME"
echo "[INFO] 백업 형식: plain SQL + gzip"
echo "[INFO] 임시 디렉터리: \$REMOTE_BACKUP_DIR"

if ! \$DOCKER info >/dev/null 2>&1; then
    echo "[ERROR] Docker daemon에 접근할 수 없습니다."
    exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
    echo "[ERROR] EC2 인스턴스에 AWS CLI가 설치되어 있지 않습니다."
    exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
    echo "[ERROR] EC2 인스턴스에 tar 명령이 없습니다."
    exit 1
fi

if ! command -v gzip >/dev/null 2>&1; then
    echo "[ERROR] EC2 인스턴스에 gzip 명령이 없습니다."
    exit 1
fi

if ! command -v sha256sum >/dev/null 2>&1; then
    echo "[ERROR] EC2 인스턴스에 sha256sum 명령이 없습니다."
    exit 1
fi

rm -rf "\$REMOTE_BACKUP_DIR"
rm -f "\$REMOTE_ARCHIVE"

mkdir -p "\$REMOTE_BACKUP_DIR"

printf \
    'container\tpostgres_user\tpostgres_database\tbackup_file\tbackup_format\n' \
    > "\$REMOTE_BACKUP_DIR/databases.tsv"

{
    echo "backup_timestamp=\$TIMESTAMP"
    echo "backup_started_at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "backup_host=\$(hostname)"
    echo "backup_source=remote_ec2"
    echo "backup_format=postgresql_plain_sql_gzip"
    echo "container_count=\${#DB_CONTAINERS[@]}"
} > "\$REMOTE_BACKUP_DIR/backup_info.txt"

for container in "\${DB_CONTAINERS[@]}"; do
    echo
    echo "[INFO] 컨테이너 확인: \$container"

    if ! \$DOCKER inspect "\$container" >/dev/null 2>&1; then
        echo "[ERROR] DB 컨테이너를 찾지 못했습니다: \$container"
        exit 1
    fi

    container_status="\$(
        \$DOCKER inspect \
            --format '{{.State.Status}}' \
            "\$container" \
            2>/dev/null || true
    )"

    if [[ "\$container_status" != "running" ]]; then
        echo "[ERROR] DB 컨테이너가 실행 중이 아닙니다."
        echo "[ERROR] container=\$container"
        echo "[ERROR] status=\${container_status:-unknown}"
        exit 1
    fi

    postgres_user="\$(
        \$DOCKER exec "\$container" \
            sh -c 'printf "%s" "\${POSTGRES_USER:-postgres}"'
    )"

    postgres_database="\$(
        \$DOCKER exec "\$container" \
            sh -c 'printf "%s" "\${POSTGRES_DB:-\${POSTGRES_USER:-postgres}}"'
    )"

    if [[ -z "\$postgres_user" ]]; then
        postgres_user="postgres"
    fi

    if [[ -z "\$postgres_database" ]]; then
        postgres_database="\$postgres_user"
    fi

    postgres_version="\$(
        \$DOCKER exec "\$container" \
            pg_dump --version \
            2>/dev/null || true
    )"

    postgres_server_version="\$(
        \$DOCKER exec "\$container" \
            postgres --version \
            2>/dev/null || true
    )"

    echo "[INFO] container=\$container"
    echo "[INFO] user=\$postgres_user"
    echo "[INFO] database=\$postgres_database"
    echo "[INFO] server=\${postgres_server_version:-unknown}"
    echo "[INFO] pg_dump=\${postgres_version:-unknown}"

    if ! \$DOCKER exec "\$container" \
        pg_isready \
            --username="\$postgres_user" \
            --dbname="\$postgres_database" \
            >/dev/null 2>&1; then

        echo "[ERROR] PostgreSQL 연결 확인 실패: \$container"
        exit 1
    fi

    backup_file_name="\${container}.sql.gz"
    backup_file_path="\$REMOTE_BACKUP_DIR/\$backup_file_name"

    echo "[INFO] plain SQL gzip 백업 생성: \$backup_file_name"

    if ! \$DOCKER exec "\$container" \
        pg_dump \
            --format=plain \
            --no-owner \
            --no-privileges \
            --username="\$postgres_user" \
            --dbname="\$postgres_database" \
        | gzip -c \
        > "\$backup_file_path"; then

        echo "[ERROR] PostgreSQL 백업 실패: \$container"
        rm -f "\$backup_file_path"
        exit 1
    fi

    if [[ ! -s "\$backup_file_path" ]]; then
        echo "[ERROR] 생성된 SQL 백업 파일이 비어 있습니다."
        echo "[ERROR] file=\$backup_file_path"
        exit 1
    fi

    if ! gzip -t "\$backup_file_path"; then
        echo "[ERROR] gzip 무결성 검사 실패: \$container"
        exit 1
    fi

    if ! gzip -dc "\$backup_file_path" \
        | awk '
            NR <= 30 && /PostgreSQL database dump/ {
                found = 1
            }
            END {
                exit(found ? 0 : 1)
            }
        '; then

        echo "[ERROR] PostgreSQL plain SQL 백업으로 확인되지 않습니다."
        echo "[ERROR] container=\$container"
        echo "[ERROR] file=\$backup_file_path"

        echo "[INFO] SQL 백업 파일의 처음 10줄:"

        gzip -dc "\$backup_file_path" \
            | sed -n '1,10p' \
            || true

        exit 1
    fi

    backup_size="\$(du -h "\$backup_file_path" | awk '{print \$1}')"

    printf '%s\t%s\t%s\t%s\t%s\n' \
        "\$container" \
        "\$postgres_user" \
        "\$postgres_database" \
        "\$backup_file_name" \
        "plain_sql_gzip" \
        >> "\$REMOTE_BACKUP_DIR/databases.tsv"

    {
        echo
        echo "[\$container]"
        echo "postgres_user=\$postgres_user"
        echo "postgres_database=\$postgres_database"
        echo "postgres_server_version=\$postgres_server_version"
        echo "pg_dump_version=\$postgres_version"
        echo "backup_file=\$backup_file_name"
        echo "backup_format=plain_sql_gzip"
        echo "backup_size=\$backup_size"
    } >> "\$REMOTE_BACKUP_DIR/backup_info.txt"

    echo "[OK] 백업 완료: \$container (\$backup_size)"
done

echo
echo "[INFO] SHA256 체크섬 생성"

(
    cd "\$REMOTE_BACKUP_DIR"
    sha256sum ./*.sql.gz > SHA256SUMS
)

{
    echo
    echo "backup_finished_at=\$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "backup_status=success"
} >> "\$REMOTE_BACKUP_DIR/backup_info.txt"

echo "[INFO] 최종 백업 압축"

tar \
    -C "/tmp" \
    -czf "\$REMOTE_ARCHIVE" \
    "\$BACKUP_NAME"

if [[ ! -s "\$REMOTE_ARCHIVE" ]]; then
    echo "[ERROR] 최종 압축 파일이 생성되지 않았습니다."
    exit 1
fi

archive_size="\$(du -h "\$REMOTE_ARCHIVE" | awk '{print \$1}')"

echo "[INFO] 압축 파일 크기: \$archive_size"
echo "[INFO] S3 임시 업로드: \$S3_URI"

aws s3 cp \
    "\$REMOTE_ARCHIVE" \
    "\$S3_URI" \
    --region "\$AWS_REGION" \
    --only-show-errors

echo
echo "[OK] EC2 DB 백업 완료"
echo "[OK] S3 임시 업로드 완료"
echo "[OK] archive_size=\$archive_size"
EOF
}

# =========================================================
# SSM 원격 명령 실행
# =========================================================

run_backup_ssm_command() {
    local instance_id="$1"
    local remote_script="$2"

    local remote_script_b64
    local remote_command
    local command_id
    local status
    local stdout_content
    local stderr_content

    remote_script_b64="$(
        printf '%s' "$remote_script" \
            | base64 \
            | tr -d '\n'
    )"

    remote_command="echo '$remote_script_b64' | base64 -d | bash"

    command_id="$(
        aws ssm send-command \
            --instance-ids "$instance_id" \
            --document-name "AWS-RunShellScript" \
            --parameters "commands=[\"$remote_command\"]" \
            --region "$AWS_REGION" \
            --query "Command.CommandId" \
            --output text
    )"

    log "SSM CommandId=$command_id"
    log "원격 DB 백업 완료 대기 중..."

    aws ssm wait command-executed \
        --command-id "$command_id" \
        --instance-id "$instance_id" \
        --region "$AWS_REGION" \
        2>/dev/null || true

    status="$(
        aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$instance_id" \
            --region "$AWS_REGION" \
            --query "Status" \
            --output text
    )"

    stdout_content="$(
        aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$instance_id" \
            --region "$AWS_REGION" \
            --query "StandardOutputContent" \
            --output text
    )"

    stderr_content="$(
        aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$instance_id" \
            --region "$AWS_REGION" \
            --query "StandardErrorContent" \
            --output text
    )"

    echo
    echo "─── BACKUP STDOUT ────────────────────────────"
    echo "$stdout_content"

    if [[ -n "$stderr_content" \
        && "$stderr_content" != "None" ]]; then

        echo
        echo "─── BACKUP STDERR ────────────────────────────"
        echo "$stderr_content"
    fi

    if [[ "$status" != "Success" ]]; then
        err "원격 DB 백업 실패: Status=$status"
        return 1
    fi

    return 0
}

# =========================================================
# EC2 DB를 로컬로 백업
# =========================================================

backup_databases_to_local() {
    local instance_id="${1:-}"
    local local_backup_root="${2:-${BACKUP_REPO_ROOT}/backup}"

    local timestamp
    local backup_name
    local archive_name
    local s3_uri
    local local_archive
    local local_backup_directory
    local remote_script
    local backup_count

    require_backup_config

    if [[ -z "$instance_id" ]]; then
        log "ASG($ASG_NAME)의 백업 대상 인스턴스 조회 중..."
        instance_id="$(find_backup_instance)"
    else
        log "사용자 지정 인스턴스 사용: $instance_id"
    fi

    if [[ "$instance_id" != i-* ]]; then
        err "유효하지 않은 인스턴스 ID입니다: $instance_id"
        return 1
    fi

    validate_backup_instance "$instance_id"

    timestamp="$(date +%Y%m%d%H%M%S)"
    backup_name="db_backup_${timestamp}"
    archive_name="${backup_name}.tar.gz"

    s3_uri="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/${instance_id}/${archive_name}"

    local_archive="${local_backup_root}/${archive_name}"
    local_backup_directory="${local_backup_root}/${backup_name}"

    mkdir -p "$local_backup_root"

    if [[ -e "$local_archive" \
        || -e "$local_backup_directory" ]]; then

        err "동일한 백업 경로가 이미 존재합니다."
        err "path=$local_backup_directory"
        return 1
    fi

    log "DB 백업 시작"
    log "대상 인스턴스: $instance_id"
    log "로컬 백업 경로: $local_backup_directory"
    log "임시 S3 경로: $s3_uri"

    remote_script="$(
        build_remote_backup_script \
            "$timestamp" \
            "$s3_uri"
    )"

    if ! run_backup_ssm_command \
        "$instance_id" \
        "$remote_script"; then

        err "원격 백업 실패로 종료합니다."
        return 1
    fi

    log "S3에서 로컬로 백업 다운로드"

    if ! aws s3 cp \
        "$s3_uri" \
        "$local_archive" \
        --region "$AWS_REGION" \
        --only-show-errors; then

        err "백업 파일 다운로드 실패"
        err "S3 임시 객체는 삭제하지 않았습니다."
        err "S3_URI=$s3_uri"
        return 1
    fi

    if [[ ! -s "$local_archive" ]]; then
        err "다운로드한 백업 파일이 비어 있습니다."
        rm -f "$local_archive"
        return 1
    fi

    log "다운로드된 압축 파일 검사"

    if ! gzip -t "$local_archive"; then
        err "다운로드한 압축 파일이 손상되었습니다."
        rm -f "$local_archive"
        return 1
    fi

    log "백업 압축 해제"

    if ! COPYFILE_DISABLE=1 tar \
        -xzf "$local_archive" \
        -C "$local_backup_root"; then

        err "백업 압축 해제 실패"
        rm -rf "$local_backup_directory"
        return 1
    fi

    if command -v xattr >/dev/null 2>&1; then
        xattr -cr "$local_backup_directory" >/dev/null 2>&1 || true
    fi

    log "로컬 백업 파일 검증"

    if ! validate_backup_directory "$local_backup_directory"; then
        err "로컬 백업 파일 검증 실패"
        err "S3 임시 객체는 확인을 위해 유지합니다."
        err "S3_URI=$s3_uri"
        return 1
    fi

    backup_count="$(
        find "$local_backup_directory" \
            -maxdepth 1 \
            -type f \
            -name '*.sql.gz' \
            | wc -l \
            | tr -d ' '
    )"

    rm -f "$local_archive"

    log "S3 임시 객체 삭제"

    if ! aws s3 rm \
        "$s3_uri" \
        --region "$AWS_REGION" \
        --only-show-errors; then

        warn "S3 임시 객체 삭제에 실패했습니다."
        warn "수동 삭제 대상: $s3_uri"
    fi

    echo
    ok "DB 로컬 백업 완료"
    ok "백업 경로: $local_backup_directory"
    ok "SQL 백업 파일 수: $backup_count"

    echo
    ls -lh "$local_backup_directory"

    echo
    du -sh "$local_backup_directory"
}

# =========================================================
# 직접 실행
# =========================================================

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    MODE="remote"
    TARGET=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -local)
                MODE="local"
                shift
                ;;

            -h|--help)
                usage
                exit 0
                ;;

            i-*)
                if [[ -n "$TARGET" ]]; then
                    err "인스턴스 ID는 하나만 지정할 수 있습니다."
                    usage
                    exit 1
                fi

                TARGET="$1"
                shift
                ;;

            -*)
                err "알 수 없는 옵션: $1"
                usage
                exit 1
                ;;

            *)
                err "알 수 없는 인자: $1"
                usage
                exit 1
                ;;
        esac
    done

    if [[ "$MODE" == "local" && -n "$TARGET" ]]; then
        err "-local 옵션과 인스턴스 ID는 동시에 사용할 수 없습니다."
        usage
        exit 1
    fi

    if [[ "$MODE" == "local" ]]; then
        backup_local_databases \
            "$BACKUP_REPO_ROOT/backup"

        exit 0
    fi

    require_aws

    backup_databases_to_local \
        "$TARGET" \
        "$BACKUP_REPO_ROOT/backup"
fi