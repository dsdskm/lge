#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

MODE="image"
RUN_BACKUP=false
RUN_RESTORE=false
BACKUP_PATH=""

usage() {
    cat <<EOF
Usage:
  $0
  $0 image
  $0 instance
  $0 -backup
  $0 -backup -restore
  $0 image -backup
  $0 image -backup -restore

Options:
  image               현재 인스턴스의 Docker 이미지를 교체합니다.
  instance            현재 ASG 인스턴스를 종료하고 새 인스턴스로 교체합니다.
  -backup, --backup   배포 직전에 backup.sh를 실행합니다.
  -restore, --restore 배포 완료 후 이번 실행에서 생성한 백업으로 restore.sh를 실행합니다.
  -h, --help          도움말을 출력합니다.

Examples:
  $0
  $0 image
  $0 instance
  $0 -backup
  $0 -backup -restore

Notes:
  -restore는 -backup과 함께 사용해야 합니다.
  instance 모드에서는 -restore를 사용할 수 없습니다.
EOF
}

# --------------------------------------------------------
# 인자 처리
# --------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        image)
            MODE="image"
            shift
            ;;

        instance)
            MODE="instance"
            shift
            ;;

        -backup|--backup)
            RUN_BACKUP=true
            shift
            ;;

        -restore|--restore)
            RUN_RESTORE=true
            shift
            ;;

        -h|--help)
            usage
            exit 0
            ;;

        *)
            err "알 수 없는 옵션: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ "$MODE" != "image" && "$MODE" != "instance" ]]; then
    err "지원하지 않는 배포 모드: $MODE"
    exit 1
fi

if [[ "$RUN_RESTORE" == true && "$RUN_BACKUP" != true ]]; then
    err "-restore 옵션은 -backup 옵션과 함께 사용해야 합니다."
    err "예: ./deploy.sh -backup -restore"
    exit 1
fi

if [[ "$MODE" == "instance" && "$RUN_RESTORE" == true ]]; then
    err "instance 모드에서는 -restore 옵션을 사용할 수 없습니다."
    exit 1
fi

require_aws
require_docker

cd "$REPO_ROOT"

# --------------------------------------------------------
# ECR 로그인
# --------------------------------------------------------

log "ECR 로그인"

aws ecr get-login-password \
    --region "$AWS_REGION" |
    docker login \
        --username AWS \
        --password-stdin \
        "$ECR_REGISTRY"

ok "ECR 로그인 완료"

# --------------------------------------------------------
# Docker Build
# --------------------------------------------------------

log "Docker Build"

BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo '')"

DOCKER_BUILDKIT=1 docker build \
    --platform "$TARGET_PLATFORM" \
    --build-arg BUILD_TIME="$BUILD_TIME" \
    --build-arg GIT_COMMIT="$GIT_COMMIT" \
    -t "$IMAGE_LOCAL" \
    .

log "빌드 정보 BUILD_TIME=$BUILD_TIME GIT_COMMIT=$GIT_COMMIT"

ok "빌드 완료"

# --------------------------------------------------------
# Docker Tag
# --------------------------------------------------------

log "Docker Tag"

docker tag "$IMAGE_LOCAL" "$IMAGE_REMOTE"

ok "태그 완료"

# --------------------------------------------------------
# Docker Push
# --------------------------------------------------------

log "Docker Push"

docker push "$IMAGE_REMOTE"

ok "푸시 완료"

# --------------------------------------------------------
# 배포 대상 인스턴스 조회
# --------------------------------------------------------

read -r -a CANDIDATE_INSTANCE_IDS <<<"$(
    aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names "$ASG_NAME" \
        --region "$AWS_REGION" \
        --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService' && HealthStatus=='Healthy'].InstanceId" \
        --output text
)"

if [[ ${#CANDIDATE_INSTANCE_IDS[@]} -eq 0 ||
      "${CANDIDATE_INSTANCE_IDS[0]}" == "None" ]]; then
    err "InService + Healthy 인스턴스를 찾지 못했습니다."
    exit 1
fi

VALID_INSTANCE_IDS=()

for candidate in "${CANDIDATE_INSTANCE_IDS[@]}"; do
    if [[ -z "$candidate" || "$candidate" == "None" ]]; then
        continue
    fi

    INSTANCE_STATE="$(
        aws ec2 describe-instances \
            --instance-ids "$candidate" \
            --region "$AWS_REGION" \
            --query "Reservations[0].Instances[0].State.Name" \
            --output text \
            2>/dev/null || true
    )"

    SSM_PING_STATUS="$(
        aws ssm describe-instance-information \
            --region "$AWS_REGION" \
            --filters "Key=InstanceIds,Values=$candidate" \
            --query "InstanceInformationList[0].PingStatus" \
            --output text \
            2>/dev/null || true
    )"

    if [[ "$INSTANCE_STATE" == "running" &&
          "$SSM_PING_STATUS" == "Online" ]]; then
        VALID_INSTANCE_IDS+=("$candidate")
    else
        warn "후보 제외: $candidate (state=${INSTANCE_STATE:-unknown}, ssm=${SSM_PING_STATUS:-unknown})"
    fi
done

if [[ ${#VALID_INSTANCE_IDS[@]} -eq 0 ]]; then
    err "SSM 실행 가능한 인스턴스를 찾지 못했습니다."
    err "필요 조건: state=running, SSM PingStatus=Online"
    err "ASG=${ASG_NAME}"
    exit 1
fi

if [[ ${#VALID_INSTANCE_IDS[@]} -ne 1 ]]; then
    err "현재 유효 인스턴스 수=${#VALID_INSTANCE_IDS[@]} (1대 고정 위반)"
    err "ASG의 desired/min/max를 1로 맞추고 다시 실행하세요."
    err "감지된 인스턴스: ${VALID_INSTANCE_IDS[*]}"
    exit 1
fi

INSTANCE_ID="${VALID_INSTANCE_IDS[0]}"

ok "배포 대상 인스턴스 수: ${#VALID_INSTANCE_IDS[@]}"
ok "배포 대상: $INSTANCE_ID"

# --------------------------------------------------------
# 새 백업 디렉터리 찾기
# --------------------------------------------------------

find_latest_backup_directory() {
    local backup_root="$1"

    if [[ ! -d "$backup_root" ]]; then
        return 1
    fi

    find "$backup_root" \
        -mindepth 1 \
        -maxdepth 1 \
        -type d \
        -name 'db_backup_*' \
        -print 2>/dev/null |
        while IFS= read -r backup_directory; do
            local modified_time

            modified_time="$(
                stat -f '%m' "$backup_directory" 2>/dev/null ||
                stat -c '%Y' "$backup_directory" 2>/dev/null ||
                echo 0
            )"

            printf '%s\t%s\n' "$modified_time" "$backup_directory"
        done |
        sort -nr |
        awk -F'\t' 'NR == 1 { print $2 }'
}

# --------------------------------------------------------
# 배포 직전 백업
# --------------------------------------------------------

if [[ "$RUN_BACKUP" == true ]]; then
    BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
    BACKUP_ROOT="$REPO_ROOT/backup"

    if [[ ! -f "$BACKUP_SCRIPT" ]]; then
        err "backup.sh를 찾지 못했습니다: $BACKUP_SCRIPT"
        exit 1
    fi

    BEFORE_BACKUP_LIST="$(mktemp)"
    AFTER_BACKUP_LIST="$(mktemp)"

    cleanup_backup_lists() {
        rm -f "$BEFORE_BACKUP_LIST" "$AFTER_BACKUP_LIST"
    }

    trap cleanup_backup_lists EXIT

    if [[ -d "$BACKUP_ROOT" ]]; then
        find "$BACKUP_ROOT" \
            -mindepth 1 \
            -maxdepth 1 \
            -type d \
            -name 'db_backup_*' \
            -print 2>/dev/null |
            sort > "$BEFORE_BACKUP_LIST"
    else
        : > "$BEFORE_BACKUP_LIST"
    fi

    log "배포 직전 데이터베이스 백업 수행"
    log "백업 대상 인스턴스: $INSTANCE_ID"

    bash "$BACKUP_SCRIPT" "$INSTANCE_ID"

    if [[ -d "$BACKUP_ROOT" ]]; then
        find "$BACKUP_ROOT" \
            -mindepth 1 \
            -maxdepth 1 \
            -type d \
            -name 'db_backup_*' \
            -print 2>/dev/null |
            sort > "$AFTER_BACKUP_LIST"
    else
        : > "$AFTER_BACKUP_LIST"
    fi

    BACKUP_PATH="$(
        comm -13 "$BEFORE_BACKUP_LIST" "$AFTER_BACKUP_LIST" |
            while IFS= read -r backup_directory; do
                if [[ -d "$backup_directory" ]]; then
                    modified_time="$(
                        stat -f '%m' "$backup_directory" 2>/dev/null ||
                        stat -c '%Y' "$backup_directory" 2>/dev/null ||
                        echo 0
                    )"

                    printf '%s\t%s\n' "$modified_time" "$backup_directory"
                fi
            done |
            sort -nr |
            awk -F'\t' 'NR == 1 { print $2 }'
    )"

    rm -f "$BEFORE_BACKUP_LIST" "$AFTER_BACKUP_LIST"
    trap - EXIT

    if [[ -z "$BACKUP_PATH" ]]; then
        warn "새로 생성된 백업 디렉터리 차이를 감지하지 못했습니다."
        warn "가장 최근 백업 디렉터리를 다시 조회합니다."

        BACKUP_PATH="$(find_latest_backup_directory "$BACKUP_ROOT" || true)"
    fi

    if [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
        err "backup.sh는 완료됐지만 백업 디렉터리를 찾지 못했습니다."
        err "확인 경로: $BACKUP_ROOT"
        exit 1
    fi

    BACKUP_PATH="$(cd "$BACKUP_PATH" && pwd)"

    ok "배포 직전 백업 완료"
    ok "백업 경로: $BACKUP_PATH"
fi

# --------------------------------------------------------
# instance 모드
# --------------------------------------------------------

if [[ "$MODE" == "instance" ]]; then
    warn "인스턴스 교체 모드"

    aws autoscaling terminate-instance-in-auto-scaling-group \
        --instance-id "$INSTANCE_ID" \
        --no-should-decrement-desired-capacity \
        --region "$AWS_REGION"

    ok "인스턴스 종료 요청 완료"
    ok "ASG가 새 인스턴스를 생성합니다."

    exit 0
fi

# --------------------------------------------------------
# image 모드
# --------------------------------------------------------

log "이미지 교체 배포"

# shell 변수 값을 원격 스크립트에서 안전하게 사용할 수 있도록
# Bash 형식으로 escape한다.
printf -v REMOTE_CONFIG \
'APP_DIR=%q
AWS_REGION=%q
ECR_REGISTRY=%q
IMAGE_REMOTE=%q
COMPOSE_FILE=%q
COMPOSE_PROJECT_NAME=%q
ENV_FILE=%q
' \
    "$APP_DIR" \
    "$AWS_REGION" \
    "$ECR_REGISTRY" \
    "$IMAGE_REMOTE" \
    "$COMPOSE_FILE" \
    "$COMPOSE_PROJECT_NAME" \
    "$ENV_FILE"

# quoted heredoc을 사용하여 원격 스크립트 내부의
# $, ", $(...) 등을 로컬 셸이 해석하지 않도록 한다.
REMOTE_SCRIPT_BODY="$(cat <<'REMOTE_SCRIPT_EOF'
#!/usr/bin/env bash

set -euo pipefail

echo "[INFO] 원격 배포 스크립트 시작"
echo "[INFO] 실행 사용자: $(id)"
echo "[INFO] 작업 디렉터리: $APP_DIR"

if [[ ! -d "$APP_DIR" ]]; then
    echo "[ERROR] APP_DIR이 존재하지 않습니다: $APP_DIR"
    exit 1
fi

cd "$APP_DIR"

# --------------------------------------------------------
# Docker 명령 선택
# --------------------------------------------------------

DOCKER=()

select_docker_command() {
    if command -v sudo >/dev/null 2>&1; then
        if sudo -n docker info >/dev/null 2>&1; then
            DOCKER=(sudo -n docker)
            return 0
        fi
    fi

    if command -v docker >/dev/null 2>&1; then
        if docker info >/dev/null 2>&1; then
            DOCKER=(docker)
            return 0
        fi
    fi

    DOCKER=()
    return 1
}

# ASG가 새로 띄운 인스턴스일 수 있으므로 Docker 준비를 기다린다.
if ! select_docker_command; then
    echo "[INFO] Docker daemon 준비 대기"
    echo "[INFO] 최대 대기 시간: 300초"

    if command -v sudo >/dev/null 2>&1 &&
       command -v systemctl >/dev/null 2>&1; then
        echo "[INFO] Docker 서비스 기동 시도"

        sudo -n systemctl enable docker >/dev/null 2>&1 || true
        sudo -n systemctl start docker >/dev/null 2>&1 || true
    fi

    for attempt in $(seq 1 60); do
        if select_docker_command; then
            echo "[OK] Docker daemon 준비 완료: attempt=$attempt"
            break
        fi

        if (( attempt % 6 == 0 )); then
            elapsed_seconds=$((attempt * 5))
            echo "[INFO] Docker daemon 대기 중: ${elapsed_seconds}초 경과"
        fi

        sleep 5
    done
fi

if [[ ${#DOCKER[@]} -eq 0 ]]; then
    echo "[ERROR] Docker daemon 접근 실패"

    echo "[ERROR] 실행 사용자:"
    id || true

    echo "[ERROR] 그룹:"
    groups || true

    echo "[ERROR] Docker 실행 파일:"
    command -v docker || true

    echo "[ERROR] Docker 소켓:"
    ls -l /var/run/docker.sock 2>/dev/null || true

    if command -v systemctl >/dev/null 2>&1; then
        echo "[ERROR] Docker 서비스 활성 상태:"
        systemctl is-active docker 2>/dev/null || true

        echo "[ERROR] Docker 서비스 상세 상태:"
        systemctl status docker --no-pager -l 2>/dev/null || true
    fi

    if command -v sudo >/dev/null 2>&1; then
        echo "[ERROR] sudo 권한 확인:"

        if sudo -n true >/dev/null 2>&1; then
            echo "[INFO] sudo -n 사용 가능"
        else
            echo "[ERROR] sudo -n 사용 불가"
        fi

        echo "[ERROR] sudo docker info 확인:"
        sudo -n docker info 2>&1 || true
    fi

    echo "[ERROR] 일반 docker info 확인:"
    docker info 2>&1 || true

    exit 1
fi

echo "[OK] Docker 명령 선택 완료: ${DOCKER[*]}"

# --------------------------------------------------------
# Docker Compose 명령 선택
# --------------------------------------------------------

COMPOSE=()

if "${DOCKER[@]}" compose version >/dev/null 2>&1; then
    COMPOSE=("${DOCKER[@]}" compose)

elif command -v docker-compose >/dev/null 2>&1; then
    if [[ "${DOCKER[0]}" == "sudo" ]]; then
        COMPOSE=(sudo -n docker-compose)
    else
        COMPOSE=(docker-compose)
    fi

else
    echo "[ERROR] docker compose 또는 docker-compose를 찾지 못했습니다."

    echo "[ERROR] Docker 버전:"
    "${DOCKER[@]}" version || true

    exit 1
fi

echo "[OK] Docker Compose 명령 선택 완료: ${COMPOSE[*]}"

# --------------------------------------------------------
# 필수 명령 및 경로 확인
# --------------------------------------------------------

if ! command -v aws >/dev/null 2>&1; then
    echo "[ERROR] AWS CLI를 찾지 못했습니다."
    exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo "[ERROR] ENV_FILE을 찾지 못했습니다: $ENV_FILE"
    exit 1
fi

COMPOSE_DIRECTORY="$(dirname "$COMPOSE_FILE")"

if [[ ! -d "$COMPOSE_DIRECTORY" ]]; then
    echo "[INFO] Compose 디렉터리 생성: $COMPOSE_DIRECTORY"
    mkdir -p "$COMPOSE_DIRECTORY"
fi

# --------------------------------------------------------
# ECR 로그인
# --------------------------------------------------------

echo "[INFO] 원격 ECR 로그인"

aws ecr get-login-password \
    --region "$AWS_REGION" |
    "${DOCKER[@]}" login \
        --username AWS \
        --password-stdin \
        "$ECR_REGISTRY"

echo "[OK] 원격 ECR 로그인 완료"

# --------------------------------------------------------
# Docker 이미지 Pull
# --------------------------------------------------------

echo "[INFO] 이미지 Pull: $IMAGE_REMOTE"

"${DOCKER[@]}" pull "$IMAGE_REMOTE"

echo "[OK] 이미지 Pull 완료"

# --------------------------------------------------------
# 임시 컨테이너 정리 함수
# --------------------------------------------------------

TEMP_CONTAINER=""

cleanup_remote() {
    local rc=$?

    if [[ -n "$TEMP_CONTAINER" ]]; then
        "${DOCKER[@]}" rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true
    fi

    exit "$rc"
}

trap cleanup_remote EXIT

# --------------------------------------------------------
# 이미지에서 compose.qa.yml 추출
# --------------------------------------------------------

echo "[INFO] 이미지에서 compose.qa.yml 추출"

TEMP_CONTAINER="$("${DOCKER[@]}" create "$IMAGE_REMOTE")"

if [[ -z "$TEMP_CONTAINER" ]]; then
    echo "[ERROR] 임시 컨테이너 생성에 실패했습니다."
    exit 1
fi

if ! "${DOCKER[@]}" cp \
    "$TEMP_CONTAINER:/opt/app/compose.qa.yml" \
    "$COMPOSE_FILE"; then
    echo "[ERROR] 이미지에서 compose.qa.yml을 가져오지 못했습니다."
    echo "[ERROR] 이미지 내부 경로: /opt/app/compose.qa.yml"
    exit 1
fi

"${DOCKER[@]}" rm "$TEMP_CONTAINER"
TEMP_CONTAINER=""

echo "[OK] Compose 파일 추출 완료: $COMPOSE_FILE"

# --------------------------------------------------------
# Compose 설정 검증
# --------------------------------------------------------

echo "[INFO] Docker Compose 설정 검증"

"${COMPOSE[@]}" \
    -p "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    config --quiet

echo "[OK] Docker Compose 설정 검증 완료"

# --------------------------------------------------------
# 서비스 배포
# --------------------------------------------------------

echo "[INFO] Docker Compose 서비스 기동"

"${COMPOSE[@]}" \
    -p "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    up -d \
    --remove-orphans

echo "[OK] Docker Compose 서비스 기동 완료"

# --------------------------------------------------------
# 배포된 컨테이너 상태 출력
# --------------------------------------------------------

echo "[INFO] Docker Compose 컨테이너 상태"

"${COMPOSE[@]}" \
    -p "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    ps

echo "[INFO] 전체 실행 중인 컨테이너 상태"

"${DOCKER[@]}" ps \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

# --------------------------------------------------------
# 비정상 종료 컨테이너 검사
# --------------------------------------------------------

FAILED_SERVICES="$(
    "${COMPOSE[@]}" \
        -p "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$COMPOSE_FILE" \
        ps \
        --status exited \
        --services 2>/dev/null || true
)"

if [[ -n "$FAILED_SERVICES" ]]; then
    echo "[ERROR] 종료된 Compose 서비스가 발견되었습니다:"
    printf '%s\n' "$FAILED_SERVICES"

    while IFS= read -r failed_service; do
        [[ -z "$failed_service" ]] && continue

        echo "[ERROR] 실패 서비스 로그: $failed_service"

        "${COMPOSE[@]}" \
            -p "$COMPOSE_PROJECT_NAME" \
            --env-file "$ENV_FILE" \
            -f "$COMPOSE_FILE" \
            logs \
            --tail 100 \
            "$failed_service" || true
    done <<< "$FAILED_SERVICES"

    exit 1
fi

# --------------------------------------------------------
# 미사용 이미지 정리
# --------------------------------------------------------

echo "[INFO] 미사용 이미지 정리"

"${DOCKER[@]}" image prune -f

echo "[OK] 원격 이미지 교체 배포 완료"
REMOTE_SCRIPT_EOF
)"

REMOTE_SCRIPT="${REMOTE_CONFIG}"$'\n'"${REMOTE_SCRIPT_BODY}"

# --------------------------------------------------------
# 원격 스크립트 구문 검사
# --------------------------------------------------------

if ! printf '%s\n' "$REMOTE_SCRIPT" | bash -n; then
    err "생성된 원격 배포 스크립트의 Bash 구문이 올바르지 않습니다."
    exit 1
fi

ok "원격 배포 스크립트 구문 검사 완료"

# --------------------------------------------------------
# 원격 스크립트 Base64 인코딩
# --------------------------------------------------------

if ! command -v base64 >/dev/null 2>&1; then
    err "base64 명령을 찾지 못했습니다."
    exit 1
fi

REMOTE_SCRIPT_B64="$(
    printf '%s' "$REMOTE_SCRIPT" |
        base64 |
        tr -d '\n'
)"

REMOTE_COMMAND="printf '%s' '$REMOTE_SCRIPT_B64' | base64 -d | bash"

# --------------------------------------------------------
# SSM parameters JSON 생성
# --------------------------------------------------------

if ! command -v python3 >/dev/null 2>&1; then
    err "python3 명령을 찾지 못했습니다."
    exit 1
fi

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

# --------------------------------------------------------
# SSM 배포 실행
# --------------------------------------------------------

CMD_ID="$(
    aws ssm send-command \
        --instance-ids "$INSTANCE_ID" \
        --document-name "AWS-RunShellScript" \
        --parameters "$PARAMETERS_JSON" \
        --region "$AWS_REGION" \
        --query "Command.CommandId" \
        --output text
)"

if [[ -z "$CMD_ID" || "$CMD_ID" == "None" ]]; then
    err "SSM CommandId를 받지 못했습니다."
    exit 1
fi

log "SSM CommandId=$CMD_ID"

aws ssm wait command-executed \
    --command-id "$CMD_ID" \
    --instance-id "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    2>/dev/null || true

# --------------------------------------------------------
# SSM 실행 결과 조회
# --------------------------------------------------------

INVOCATION="$(
    aws ssm get-command-invocation \
        --command-id "$CMD_ID" \
        --instance-id "$INSTANCE_ID" \
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

RESPONSE_CODE="$(
    printf '%s' "$INVOCATION" |
        python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("ResponseCode", -1))
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

printf '\n--- DEPLOY STDOUT ---\n%s\n' "$STDOUT_CONTENT"

if [[ -n "$STDERR_CONTENT" && "$STDERR_CONTENT" != "None" ]]; then
    printf '\n--- DEPLOY STDERR ---\n%s\n' "$STDERR_CONTENT"
fi

if [[ "$STATUS" != "Success" ]]; then
    err "배포 실패: $INSTANCE_ID"
    err "Status=$STATUS"
    err "ResponseCode=$RESPONSE_CODE"
    err "SSM CommandId=$CMD_ID"
    exit 1
fi

ok "이미지 교체 완료 (1대: $INSTANCE_ID)"

# --------------------------------------------------------
# 배포 완료 후 복원
# --------------------------------------------------------

if [[ "$RUN_RESTORE" == true ]]; then
    RESTORE_SCRIPT="$SCRIPT_DIR/restore.sh"

    if [[ ! -f "$RESTORE_SCRIPT" ]]; then
        err "restore.sh를 찾지 못했습니다: $RESTORE_SCRIPT"
        exit 1
    fi

    if [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
        err "복원할 백업 디렉터리를 찾지 못했습니다."
        err "BACKUP_PATH=${BACKUP_PATH:-empty}"
        exit 1
    fi

    log "배포 완료 후 데이터베이스 복원 수행"
    log "대상 인스턴스: $INSTANCE_ID"
    log "백업 경로: $BACKUP_PATH"

    bash "$RESTORE_SCRIPT" \
        -f \
        -i "$INSTANCE_ID" \
        "$BACKUP_PATH"

    ok "배포 완료 후 데이터베이스 복원 완료"
fi

ok "전체 배포 작업 완료"