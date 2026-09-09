#!/usr/bin/env bash
#
# SSM 포트포워딩으로 EC2 안 "DB 컨테이너"(5432)를 로컬로 끌어옵니다.
# (pgAdmin4 / DBeaver 등에서 localhost로 접속하기 위함)
#
# DB는 호스트에 포트를 publish하지 않고 Docker 네트워크 안의
# DB 컨테이너(*-pg)로만 떠 있으므로, 컨테이너 Docker IP:5432로 포워딩합니다.
# (AWS-StartPortForwardingSessionToRemoteHost)
#
# 사용법:
#   ./db-tunnel-aws.sh                       # 전체 DB 터널 일괄 실행
#   ./db-tunnel-aws.sh all                   # 동일
#   ./db-tunnel-aws.sh event_receiver        # 특정 서비스 하나만 실행
#   ./db-tunnel-aws.sh event_receiver 15433  # 로컬 포트 직접 지정
#   INSTANCE_ID=i-0123... ./db-tunnel-aws.sh # 인스턴스 직접 지정
#
# 접속:
#   Host     = 127.0.0.1
#   Port     = 아래 서비스별 로컬 포트
#   User     = root
#   Password = root
#   DB       = <서비스>_db
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../aws/config.sh"

require_aws

PROJECT_TAG="${PROJECT_TAG:-rsp-ai-analysis}"
REMOTE_PORT="${REMOTE_PORT:-5432}"

# 로컬 dev DB(dev-db.sh)와 포트가 겹치면 동시에 실행할 수 없습니다.
# 마이그레이션처럼 양쪽을 동시에 열어야 할 때는 PORT_OFFSET으로 비켜 띄웁니다.
#
# 예:
#   PORT_OFFSET=10000 ./db-tunnel-aws.sh
#
# 위 예시에서는 event_receiver가 15433으로 열립니다.
PORT_OFFSET="${PORT_OFFSET:-0}"

ALL_SERVICES="config_manager event_receiver event_analyzer action_runner report_manager ai_chat_service"

# 서비스 식별자 -> 실제 DB 컨테이너 이름
#
# Bash 3.2 호환을 위해 associative array 대신 case를 사용합니다.
db_container_name_for() {
  case "$1" in
    config_manager)
      echo "config-manager-pg"
      ;;
    event_receiver)
      echo "event-receiver-pg"
      ;;
    event_analyzer)
      echo "event-analyzer-pg"
      ;;
    action_runner)
      echo "action-runner-pg"
      ;;
    report_manager)
      echo "report-manager-pg"
      ;;
    ai_chat_service)
      echo "ai-chat-service-pg"
      ;;
    *)
      echo ""
      return 1
      ;;
  esac
}

# 서비스 식별자 -> 기본 로컬 포트
#
# dev-db.sh의 포트 관례와 동일합니다.
# Bash 3.2 호환을 위해 associative array 대신 case를 사용합니다.
db_localport_for() {
  local base

  case "$1" in
    config_manager)
      base=5440
      ;;
    event_receiver)
      base=5433
      ;;
    event_analyzer)
      base=5434
      ;;
    action_runner)
      base=5436
      ;;
    report_manager)
      base=5437
      ;;
    ai_chat_service)
      base=5439
      ;;
    *)
      echo ""
      return
      ;;
  esac

  echo $((base + PORT_OFFSET))
}

# 로컬 포트가 이미 사용 중인지 검사합니다.
#
# 반환값:
#   0 = 사용 중
#   1 = 사용하지 않음 또는 검사 도구 없음
port_in_use() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  else
    # 검사 도구가 없으면 점유되지 않은 것으로 간주합니다.
    return 1
  fi
}

# session-manager-plugin 확인
if ! command -v session-manager-plugin >/dev/null 2>&1; then
  err "session-manager-plugin이 없습니다. 포트포워딩에 필요합니다."
  err "설치: brew install --cask session-manager-plugin"
  exit 1
fi

# 대상 인스턴스 조회
INSTANCE_ID="${INSTANCE_ID:-}"

for arg in "$@"; do
  if [[ "$arg" == i-* ]]; then
    INSTANCE_ID="$arg"
  fi
done

if [[ -z "$INSTANCE_ID" ]]; then
  log "Project=$PROJECT_TAG 의 running 인스턴스 조회 중..."

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
  err "PROJECT_TAG=$PROJECT_TAG 확인 또는 INSTANCE_ID를 직접 지정하세요."
  exit 1
fi

ok "대상 인스턴스: $INSTANCE_ID"

# DB 컨테이너의 Docker 네트워크 IP 조회
#
# DB 서비스는 호스트에 5432 포트를 publish하지 않으므로,
# 실제 DB 컨테이너의 Docker 네트워크 IP를 조회합니다.
#
# $1 = 서비스 식별자
container_ip() {
  local service="$1"
  local container
  local inspect_cmd
  local cmd_id

  container="$(db_container_name_for "$service")"

  if [[ -z "$container" ]]; then
    return 1
  fi

  # 기존에 정상 동작하던 로직을 유지합니다.
  # 변경된 DB 컨테이너 이름으로 컨테이너 ID를 찾은 후 IP를 조회합니다.
  inspect_cmd="cid=\$(sudo docker ps -q --filter name=$container | head -n1); sudo docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \$cid"

  cmd_id="$(
    aws ssm send-command \
      --instance-ids "$INSTANCE_ID" \
      --document-name "AWS-RunShellScript" \
      --parameters "commands=[\"$inspect_cmd\"]" \
      --region "$AWS_REGION" \
      --query "Command.CommandId" \
      --output text
  )"

  aws ssm wait command-executed \
    --command-id "$cmd_id" \
    --instance-id "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    2>/dev/null || true

  aws ssm get-command-invocation \
    --command-id "$cmd_id" \
    --instance-id "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    --query "StandardOutputContent" \
    --output text |
    tr -d '[:space:]'
}

# SSM 포트포워딩 세션 시작
#
# $1 = DB 컨테이너 IP
# $2 = 로컬 포트
start_session() {
  local ip="$1"
  local local_port="$2"

  aws ssm start-session \
    --target "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    --document-name "AWS-StartPortForwardingSessionToRemoteHost" \
    --parameters "{\"host\":[\"$ip\"],\"portNumber\":[\"$REMOTE_PORT\"],\"localPortNumber\":[\"$local_port\"]}"
}

# 단일 서비스 모드
SERVICE="${1:-all}"

# 첫 번째 인자가 인스턴스 ID이면 전체 모드로 처리합니다.
if [[ "$SERVICE" == i-* ]]; then
  SERVICE="all"
fi

if [[ "$SERVICE" != "all" ]]; then
  local_port="$(db_localport_for "$SERVICE")"
  container_name="$(db_container_name_for "$SERVICE")"

  if [[ -z "$local_port" || -z "$container_name" ]]; then
    err "알 수 없는 서비스: $SERVICE"
    err "가능한 서비스: $ALL_SERVICES"
    exit 1
  fi

  # 두 번째 인자가 숫자이면 직접 지정한 로컬 포트를 사용합니다.
  if [[ "${2:-}" =~ ^[0-9]+$ ]]; then
    local_port="$2"
  fi

  if port_in_use "$local_port"; then
    err "로컬 포트 $local_port 가 이미 사용 중입니다."
    err "기존 터널/프로세스를 종료하거나 다른 포트를 지정하세요."
    err "점유 확인: lsof -nP -iTCP:$local_port -sTCP:LISTEN"
    exit 1
  fi

  log "DB 컨테이너($container_name) IP 조회 중..."

  ip="$(container_ip "$SERVICE")"

  if [[ -z "$ip" ]]; then
    err "DB 컨테이너 IP 조회 실패: $container_name"
    err "해당 DB 컨테이너가 실행 중인지 확인하세요."
    exit 1
  fi

  ok "DB 컨테이너: $container_name"
  ok "컨테이너 IP: $ip"

  log "포트포워딩: 127.0.0.1:$local_port -> $container_name($ip):$REMOTE_PORT"
  log "pgAdmin4 접속 정보:"
  log "  Host     = 127.0.0.1"
  log "  Port     = $local_port"
  log "  User     = root"
  log "  Password = root"
  log "  DB       = ${SERVICE}_db"
  log "종료하려면 Ctrl+C를 누르세요."

  exec aws ssm start-session \
    --target "$INSTANCE_ID" \
    --region "$AWS_REGION" \
    --document-name "AWS-StartPortForwardingSessionToRemoteHost" \
    --parameters "{\"host\":[\"$ip\"],\"portNumber\":[\"$REMOTE_PORT\"],\"localPortNumber\":[\"$local_port\"]}"
fi

# 전체 모드
LOG_DIR="${TMPDIR:-/tmp}/db-tunnel"
mkdir -p "$LOG_DIR"

PIDS=""

cleanup() {
  echo
  log "터널 종료 중..."

  for pid in $PIDS; do
    kill "$pid" 2>/dev/null || true
  done

  wait 2>/dev/null || true
  ok "모든 터널 종료 완료."
}

trap cleanup INT TERM EXIT

# 시작 전에 점유 포트를 먼저 검사합니다.
busy=""

for service in $ALL_SERVICES; do
  local_port="$(db_localport_for "$service")"

  if port_in_use "$local_port"; then
    busy="$busy $service(:$local_port)"
  fi
done

if [[ -n "$busy" ]]; then
  err "이미 사용 중인 로컬 포트가 있습니다:$busy"
  err "기존 터널/프로세스를 종료하거나 PORT_OFFSET으로 비켜 띄우세요."
  err "예: PORT_OFFSET=10000 $0"
  exit 1
fi

log "DB 터널 일괄 시작 (서비스 6개)"

for service in $ALL_SERVICES; do
  local_port="$(db_localport_for "$service")"
  container_name="$(db_container_name_for "$service")"
  logfile="$LOG_DIR/$service.log"

  # 이전 로그로 준비 상태를 잘못 판단하지 않도록 초기화합니다.
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

# 각 세션이 "Waiting for connections"를 출력하면 준비 완료로 판단합니다.
# 최대 40초 동안 기다립니다.
echo
log "터널 수립 대기 중 (컨테이너 IP 조회 -> SSM 세션 수립)..."

ready_count=0
failed_count=0

for service in $ALL_SERVICES; do
  local_port="$(db_localport_for "$service")"
  container_name="$(db_container_name_for "$service")"
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

    sleep 1
  done

  case "$state" in
    ready)
      ok "$(printf '%-18s 127.0.0.1:%-6s DB 컨테이너=%s' \
        "$service" \
        "$local_port" \
        "$container_name")"

      ready_count=$((ready_count + 1))
      ;;

    ipfail)
      err "$(printf '%-18s DB 컨테이너 IP 조회 실패: %s, 로그: %s' \
        "$service" \
        "$container_name" \
        "$logfile")"

      failed_count=$((failed_count + 1))
      ;;

    *)
      err "$(printf '%-18s 준비 실패/지연: %s, 로그: %s' \
        "$service" \
        "$container_name" \
        "$logfile")"

      if [[ -s "$logfile" ]]; then
        err "최근 로그:"
        tail -n 5 "$logfile" >&2
      fi

      failed_count=$((failed_count + 1))
      ;;
  esac
done

echo

if [[ "$failed_count" -gt 0 ]]; then
  err "일부 DB 터널 수립에 실패했습니다. 성공=$ready_count, 실패=$failed_count"
  err "위에 표시된 로그 파일을 확인하세요."
  exit 1
fi

ok "모든 DB 터널 준비 완료."
log "pgAdmin4 접속:"
log "  Host     = 127.0.0.1"
log "  User     = root"
log "  Password = root"
log "  Port     = 위 서비스별 로컬 포트"

warn "이 창을 닫지 마세요. 종료하려면 Ctrl+C를 누르세요."

wait
``