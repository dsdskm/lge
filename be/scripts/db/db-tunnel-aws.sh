#!/usr/bin/env bash
#
# SSM 포트포워딩으로 EC2 내부의 DB 컨테이너 5432 포트를
# 로컬 PC로 포워딩합니다.
#
# 사용법:
#   ./db-tunnel-aws.sh
#   ./db-tunnel-aws.sh 10000
#
# 기본 실행:
#   ./db-tunnel-aws.sh
#
#   config_manager  -> 127.0.0.1:5440
#   event_receiver  -> 127.0.0.1:5433
#   event_analyzer  -> 127.0.0.1:5434
#   action_runner   -> 127.0.0.1:5436
#   report_manager  -> 127.0.0.1:5437
#   ai_chat_service -> 127.0.0.1:5439
#
# 포트 오프셋 적용:
#   ./db-tunnel-aws.sh 10000
#
#   config_manager  -> 127.0.0.1:15440
#   event_receiver  -> 127.0.0.1:15433
#   event_analyzer  -> 127.0.0.1:15434
#   action_runner   -> 127.0.0.1:15436
#   report_manager  -> 127.0.0.1:15437
#   ai_chat_service -> 127.0.0.1:15439
#
# pgAdmin4 / DBeaver 접속:
#   Host     = 127.0.0.1
#   Port     = 아래 출력되는 서비스별 로컬 포트
#   User     = root
#   Password = root
#   Database = 서비스별 데이터베이스 이름
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../aws/config.sh"

require_aws

PROJECT_TAG="${PROJECT_TAG:-rsp-ai-analysis}"
REMOTE_PORT="${REMOTE_PORT:-5432}"
PORT_OFFSET=0

ALL_SERVICES="
config_manager
event_receiver
event_analyzer
action_runner
report_manager
ai_chat_service
"

# --------------------------------------------------------
# 사용법
# --------------------------------------------------------

usage() {
    cat <<EOF
사용법:
  ./db-tunnel-aws.sh
  ./db-tunnel-aws.sh <포트_오프셋>

예:
  ./db-tunnel-aws.sh
  ./db-tunnel-aws.sh 10000

설명:
  인자가 없으면 기본 로컬 포트를 사용합니다.
  숫자를 전달하면 모든 기본 로컬 포트에 해당 숫자를 더합니다.

기본 포트:
  config_manager   5440
  event_receiver   5433
  event_analyzer   5434
  action_runner    5436
  report_manager   5437
  ai_chat_service  5439

예를 들어 10000을 전달하면:
  config_manager   15440
  event_receiver   15433
  event_analyzer   15434
  action_runner    15436
  report_manager   15437
  ai_chat_service  15439
EOF
}

# --------------------------------------------------------
# 인자 처리
#
# 지원:
#   ./db-tunnel-aws.sh
#   ./db-tunnel-aws.sh 10000
# --------------------------------------------------------

if [[ $# -gt 1 ]]; then
    err "인자는 포트 오프셋 숫자 하나만 지정할 수 있습니다."
    usage
    exit 1
fi

if [[ $# -eq 1 ]]; then
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
    esac

    if [[ ! "$1" =~ ^[0-9]+$ ]]; then
        err "포트 오프셋은 0 이상의 숫자만 입력할 수 있습니다: $1"
        usage
        exit 1
    fi

    PORT_OFFSET="$1"
fi

# --------------------------------------------------------
# 서비스 식별자에서 실제 DB 컨테이너 이름 조회
# --------------------------------------------------------

db_container_name_for() {
    case "$1" in
        config_manager)
            printf '%s\n' "config-manager-pg"
            ;;
        event_receiver)
            printf '%s\n' "event-receiver-pg"
            ;;
        event_analyzer)
            printf '%s\n' "event-analyzer-pg"
            ;;
        action_runner)
            printf '%s\n' "action-runner-pg"
            ;;
        report_manager)
            printf '%s\n' "report-manager-pg"
            ;;
        ai_chat_service)
            printf '%s\n' "ai-chat-service-pg"
            ;;
        *)
            return 1
            ;;
    esac
}

# --------------------------------------------------------
# 서비스 식별자에서 기본 로컬 포트 조회
# PORT_OFFSET을 더한 실제 로컬 포트를 반환
# --------------------------------------------------------

db_localport_for() {
    local service="$1"
    local base_port

    case "$service" in
        config_manager)
            base_port=5440
            ;;
        event_receiver)
            base_port=5433
            ;;
        event_analyzer)
            base_port=5434
            ;;
        action_runner)
            base_port=5436
            ;;
        report_manager)
            base_port=5437
            ;;
        ai_chat_service)
            base_port=5439
            ;;
        *)
            return 1
            ;;
    esac

    printf '%s\n' "$((base_port + PORT_OFFSET))"
}

# --------------------------------------------------------
# 서비스 식별자에서 데이터베이스 이름 조회
# --------------------------------------------------------

db_database_name_for() {
    case "$1" in
        config_manager)
            printf '%s\n' "config_manager_db"
            ;;
        event_receiver)
            printf '%s\n' "event_receiver_db"
            ;;
        event_analyzer)
            printf '%s\n' "event_analyzer_db"
            ;;
        action_runner)
            printf '%s\n' "action_runner_db"
            ;;
        report_manager)
            printf '%s\n' "report_manager_db"
            ;;
        ai_chat_service)
            printf '%s\n' "ai_chat_service_db"
            ;;
        *)
            return 1
            ;;
    esac
}

# --------------------------------------------------------
# 로컬 포트 사용 여부 확인
#
# 반환값:
#   0: 사용 중
#   1: 사용하지 않음 또는 검사 도구 없음
# --------------------------------------------------------

port_in_use() {
    local port="$1"

    if command -v lsof >/dev/null 2>&1; then
        lsof \
            -nP \
            -iTCP:"$port" \
            -sTCP:LISTEN \
            >/dev/null 2>&1
        return $?
    fi

    if command -v nc >/dev/null 2>&1; then
        nc \
            -z \
            127.0.0.1 \
            "$port" \
            >/dev/null 2>&1
        return $?
    fi

    return 1
}

# --------------------------------------------------------
# 필수 명령 확인
# --------------------------------------------------------

if ! command -v session-manager-plugin >/dev/null 2>&1; then
    err "session-manager-plugin이 없습니다."
    err "SSM 포트포워딩을 위해 설치가 필요합니다."
    err "설치 명령:"
    err "  brew install --cask session-manager-plugin"
    exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
    err "AWS CLI를 찾지 못했습니다."
    exit 1
fi

# --------------------------------------------------------
# 로컬 포트 범위 검증
# --------------------------------------------------------

for service in $ALL_SERVICES; do
    local_port="$(db_localport_for "$service")"

    if (( local_port < 1 || local_port > 65535 )); then
        err "계산된 로컬 포트가 유효하지 않습니다."
        err "service=$service"
        err "port=$local_port"
        err "PORT_OFFSET=$PORT_OFFSET"
        exit 1
    fi
done

# --------------------------------------------------------
# 대상 EC2 인스턴스 조회
#
# INSTANCE_ID 환경변수가 지정되면 해당 인스턴스를 사용하고,
# 지정되지 않았으면 Project 태그로 running 인스턴스를 조회합니다.
# --------------------------------------------------------

INSTANCE_ID="${INSTANCE_ID:-}"

if [[ -z "$INSTANCE_ID" ]]; then
    printf '[INFO] Project=%s의 running 인스턴스 조회 중...\n' "$PROJECT_TAG"

    INSTANCE_ID="$(
        aws ec2 describe-instances \
            --filters \
                "Name=tag:Project,Values=$PROJECT_TAG" \
                "Name=instance-state-name,Values=running" \
            --region "$AWS_REGION" \
            --query "Reservations[].Instances[].InstanceId | [0]" \
            --output text
    )"
fi

if [[ -z "$INSTANCE_ID" || "$INSTANCE_ID" == "None" ]]; then
    err "대상 인스턴스를 찾지 못했습니다."
    err "PROJECT_TAG=$PROJECT_TAG"
    err "AWS_REGION=$AWS_REGION"
    err "필요하면 INSTANCE_ID 환경변수를 지정하세요."
    err "예:"
    err "  INSTANCE_ID=i-0123456789abcdef0 ./db-tunnel-aws.sh"
    exit 1
fi

if [[ "$INSTANCE_ID" != i-* ]]; then
    err "유효하지 않은 EC2 인스턴스 ID입니다: $INSTANCE_ID"
    exit 1
fi

printf '[ OK ] 대상 인스턴스: %s\n' "$INSTANCE_ID"
printf '[INFO] 포트 오프셋: %s\n' "$PORT_OFFSET"

# --------------------------------------------------------
# SSM 상태 확인
# --------------------------------------------------------

SSM_PING_STATUS="$(
    aws ssm describe-instance-information \
        --region "$AWS_REGION" \
        --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
        --query "InstanceInformationList[0].PingStatus" \
        --output text \
        2>/dev/null || true
)"

if [[ "$SSM_PING_STATUS" != "Online" ]]; then
    err "대상 인스턴스가 SSM Online 상태가 아닙니다."
    err "INSTANCE_ID=$INSTANCE_ID"
    err "SSM_PING_STATUS=${SSM_PING_STATUS:-unknown}"
    exit 1
fi

printf '[ OK ] SSM 상태: Online\n'

# --------------------------------------------------------
# DB 컨테이너의 Docker 네트워크 IP 조회
#
# $1: 서비스 식별자
# --------------------------------------------------------

container_ip() {
    local service="$1"
    local container
    local inspect_script
    local script_b64
    local remote_command
    local parameters_json
    local command_id
    local invocation
    local status
    local stdout_content
    local stderr_content
    local ip

    container="$(db_container_name_for "$service")"

    if [[ -z "$container" ]]; then
        return 1
    fi

    inspect_script="$(cat <<EOF
#!/usr/bin/env bash

set -euo pipefail

CONTAINER_NAME='$container'

if sudo -n docker info >/dev/null 2>&1; then
    DOCKER=(sudo -n docker)
elif docker info >/dev/null 2>&1; then
    DOCKER=(docker)
else
    echo "[ERROR] Docker daemon 접근 실패" >&2
    exit 1
fi

CONTAINER_ID="\$(
    "\${DOCKER[@]}" ps \
        --filter "name=^\${CONTAINER_NAME}\$" \
        --format '{{.ID}}' |
        head -n 1
)"

if [[ -z "\$CONTAINER_ID" ]]; then
    CONTAINER_ID="\$(
        "\${DOCKER[@]}" ps \
            --filter "name=\${CONTAINER_NAME}" \
            --format '{{.ID}}' |
            head -n 1
    )"
fi

if [[ -z "\$CONTAINER_ID" ]]; then
    echo "[ERROR] 실행 중인 DB 컨테이너를 찾지 못했습니다: \$CONTAINER_NAME" >&2
    exit 1
fi

CONTAINER_IP="\$(
    "\${DOCKER[@]}" inspect \
        --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
        "\$CONTAINER_ID"
)"

if [[ -z "\$CONTAINER_IP" ]]; then
    echo "[ERROR] DB 컨테이너 IP를 찾지 못했습니다: \$CONTAINER_NAME" >&2
    exit 1
fi

printf '%s\n' "\$CONTAINER_IP"
EOF
)"

    script_b64="$(
        printf '%s' "$inspect_script" |
            base64 |
            tr -d '\n'
    )"

    remote_command="printf '%s' '$script_b64' | base64 -d | bash"

    parameters_json="$(
        REMOTE_COMMAND="$remote_command" python3 <<'PY'
import json
import os

print(json.dumps({
    "commands": [
        os.environ["REMOTE_COMMAND"]
    ]
}))
PY
    )"

    command_id="$(
        aws ssm send-command \
            --instance-ids "$INSTANCE_ID" \
            --document-name "AWS-RunShellScript" \
            --parameters "$parameters_json" \
            --region "$AWS_REGION" \
            --query "Command.CommandId" \
            --output text
    )"

    if [[ -z "$command_id" || "$command_id" == "None" ]]; then
        printf '[ERROR] SSM CommandId 생성 실패: %s\n' "$container" >&2
        return 1
    fi

    aws ssm wait command-executed \
        --command-id "$command_id" \
        --instance-id "$INSTANCE_ID" \
        --region "$AWS_REGION" \
        2>/dev/null || true

    invocation="$(
        aws ssm get-command-invocation \
            --command-id "$command_id" \
            --instance-id "$INSTANCE_ID" \
            --region "$AWS_REGION" \
            --output json
    )"

    status="$(
        printf '%s' "$invocation" |
            python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("Status", "Unknown"))
'
    )"

    stdout_content="$(
        printf '%s' "$invocation" |
            python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("StandardOutputContent", ""), end="")
'
    )"

    stderr_content="$(
        printf '%s' "$invocation" |
            python3 -c '
import json
import sys

data = json.load(sys.stdin)
print(data.get("StandardErrorContent", ""), end="")
'
    )"

    if [[ "$status" != "Success" ]]; then
        printf '[ERROR] DB 컨테이너 IP 조회 실패\n' >&2
        printf '[ERROR] container=%s\n' "$container" >&2
        printf '[ERROR] status=%s\n' "$status" >&2
        printf '[ERROR] command_id=%s\n' "$command_id" >&2

        if [[ -n "$stdout_content" ]]; then
            printf '%s\n' "$stdout_content" >&2
        fi

        if [[ -n "$stderr_content" ]]; then
            printf '%s\n' "$stderr_content" >&2
        fi

        return 1
    fi

    ip="$(
        printf '%s' "$stdout_content" |
            tr -d '[:space:]'
    )"

    if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        printf '[ERROR] 유효하지 않은 컨테이너 IP: %s\n' "$ip" >&2
        printf '[ERROR] container=%s\n' "$container" >&2
        return 1
    fi

    printf '%s\n' "$ip"
}

# --------------------------------------------------------
# SSM 포트포워딩 세션 시작
#
# $1: DB 컨테이너 IP
# $2: 로컬 포트
# --------------------------------------------------------

start_session() {
    local ip="$1"
    local local_port="$2"

    aws ssm start-session \
        --target "$INSTANCE_ID" \
        --region "$AWS_REGION" \
        --document-name "AWS-StartPortForwardingSessionToRemoteHost" \
        --parameters "{
            \"host\":[\"$ip\"],
            \"portNumber\":[\"$REMOTE_PORT\"],
            \"localPortNumber\":[\"$local_port\"]
        }"
}

# --------------------------------------------------------
# 로그 디렉터리 및 종료 처리
# --------------------------------------------------------

LOG_DIR="${TMPDIR:-/tmp}/db-tunnel"
mkdir -p "$LOG_DIR"

PIDS=""

cleanup() {
    local exit_code=$?

    trap - INT TERM EXIT

    echo
    printf '[INFO] 터널 종료 중...\n'

    for pid in $PIDS; do
        kill "$pid" 2>/dev/null || true
    done

    for pid in $PIDS; do
        wait "$pid" 2>/dev/null || true
    done

    printf '[ OK ] 모든 터널 종료 완료\n'

    exit "$exit_code"
}

trap cleanup INT TERM EXIT

# --------------------------------------------------------
# 시작 전 로컬 포트 점유 여부 검사
# --------------------------------------------------------

BUSY_PORTS=""

for service in $ALL_SERVICES; do
    local_port="$(db_localport_for "$service")"

    if port_in_use "$local_port"; then
        BUSY_PORTS="${BUSY_PORTS} ${service}(:${local_port})"
    fi
done

if [[ -n "$BUSY_PORTS" ]]; then
    err "이미 사용 중인 로컬 포트가 있습니다:$BUSY_PORTS"
    err "기존 터널 또는 프로세스를 종료하거나 다른 숫자를 지정하세요."
    err "예:"
    err "  ./db-tunnel-aws.sh 10000"
    err ""
    err "점유 확인 예:"
    err "  lsof -nP -iTCP:15433 -sTCP:LISTEN"
    exit 1
fi

# --------------------------------------------------------
# 전체 DB 터널 시작
# --------------------------------------------------------

printf '[INFO] DB 터널 일괄 시작: 서비스 6개\n'

for service in $ALL_SERVICES; do
    local_port="$(db_localport_for "$service")"
    container_name="$(db_container_name_for "$service")"
    logfile="$LOG_DIR/$service.log"

    rm -f "$logfile"

    (
        ip="$(container_ip "$service")"

        if [[ -z "$ip" ]]; then
            echo "__IP_FAIL__"
            exit 1
        fi

        echo "__IP_OK__ $ip"

        start_session "$ip" "$local_port"
    ) >"$logfile" 2>&1 &

    PIDS="$PIDS $!"
done

# --------------------------------------------------------
# 각 터널 준비 상태 확인
# --------------------------------------------------------

echo
printf '[INFO] 터널 수립 대기 중\n'
printf '[INFO] 컨테이너 IP 조회 후 SSM 세션을 시작합니다.\n'

READY_COUNT=0
FAILED_COUNT=0

for service in $ALL_SERVICES; do
    local_port="$(db_localport_for "$service")"
    container_name="$(db_container_name_for "$service")"
    database_name="$(db_database_name_for "$service")"
    logfile="$LOG_DIR/$service.log"

    state="timeout"

    for _ in $(seq 1 40); do
        if grep -q "Waiting for connections" "$logfile" 2>/dev/null; then
            state="ready"
            break
        fi

        if grep -q "__IP_FAIL__" "$logfile" 2>/dev/null; then
            state="ipfail"
            break
        fi

        if grep -q "An error occurred" "$logfile" 2>/dev/null; then
            state="error"
            break
        fi

        sleep 1
    done

    case "$state" in
        ready)
            printf '[ OK ] %-18s 127.0.0.1:%-6s DB=%-22s 컨테이너=%s\n' \
                "$service" \
                "$local_port" \
                "$database_name" \
                "$container_name"

            READY_COUNT=$((READY_COUNT + 1))
            ;;

        ipfail)
            printf '[ERROR] %-18s DB 컨테이너 IP 조회 실패: %s\n' \
                "$service" \
                "$container_name" \
                >&2

            printf '[ERROR] 로그: %s\n' "$logfile" >&2

            if [[ -s "$logfile" ]]; then
                tail -n 20 "$logfile" >&2
            fi

            FAILED_COUNT=$((FAILED_COUNT + 1))
            ;;

        error)
            printf '[ERROR] %-18s SSM 세션 시작 실패\n' \
                "$service" \
                >&2

            printf '[ERROR] 로그: %s\n' "$logfile" >&2

            if [[ -s "$logfile" ]]; then
                tail -n 20 "$logfile" >&2
            fi

            FAILED_COUNT=$((FAILED_COUNT + 1))
            ;;

        *)
            printf '[ERROR] %-18s 준비 실패 또는 시간 초과\n' \
                "$service" \
                >&2

            printf '[ERROR] 컨테이너: %s\n' "$container_name" >&2
            printf '[ERROR] 로컬 포트: %s\n' "$local_port" >&2
            printf '[ERROR] 로그: %s\n' "$logfile" >&2

            if [[ -s "$logfile" ]]; then
                printf '[ERROR] 최근 로그:\n' >&2
                tail -n 20 "$logfile" >&2
            fi

            FAILED_COUNT=$((FAILED_COUNT + 1))
            ;;
    esac
done

echo

if [[ "$FAILED_COUNT" -gt 0 ]]; then
    err "일부 DB 터널 수립에 실패했습니다."
    err "성공=$READY_COUNT"
    err "실패=$FAILED_COUNT"
    err "로그 디렉터리: $LOG_DIR"
    exit 1
fi

# --------------------------------------------------------
# 접속 정보 출력
# --------------------------------------------------------

printf '[ OK ] 모든 DB 터널 준비 완료\n'
echo
printf '[INFO] pgAdmin4 / DBeaver 공통 접속 정보\n'
printf '[INFO]   Host     = 127.0.0.1\n'
printf '[INFO]   User     = root\n'
printf '[INFO]   Password = root\n'
printf '[INFO]\n'
printf '[INFO] 서비스별 접속 정보\n'

for service in $ALL_SERVICES; do
    local_port="$(db_localport_for "$service")"
    database_name="$(db_database_name_for "$service")"

    printf '[INFO]   %-18s Port=%-6s DB=%s\n' \
        "$service" \
        "$local_port" \
        "$database_name"
done

echo
printf '[WARN] 이 터미널 창을 닫지 마세요.\n'
printf '[WARN] 종료하려면 Ctrl+C를 누르세요.\n'

wait