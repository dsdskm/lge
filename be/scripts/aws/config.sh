#!/usr/bin/env bash

# =========================================================
# Common AWS / ECR / Deploy Config
# =========================================================

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-398838060384}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"

ECR_REPOSITORY="${ECR_REPOSITORY:-rsp-qa-ai/unified-service}"

# =========================================================
# DB Backup Config
# =========================================================

# EC2 -> S3 -> Local 백업 전달용 버킷
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-rsp-qa-ai}"

# S3 내부 임시 저장 경로
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backup_db}"

# CloudWatch Logs (compose.qa.yml 의 awslogs-group 과 동일, 스트림=서비스명)
LOG_GROUP="${LOG_GROUP:-/aws/ec2/rsp-qa-ai}"

IMAGE_TAG="${IMAGE_TAG:-latest}"

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

IMAGE_LOCAL="${IMAGE_LOCAL:-unified-service:${IMAGE_TAG}}"
IMAGE_REMOTE="${IMAGE_REMOTE:-${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}}"

TARGET_PLATFORM="${TARGET_PLATFORM:-linux/amd64}"

# =========================================================
# ASG / ALB Config
# =========================================================

ASG_NAME="${ASG_NAME:-rsp-qa-ai-app-asg}"

# ALB DNS는 실제 값으로 넣거나 실행 시 환경변수로 주입 가능
# 예:
ALB_DNS="rsp-qa-ai-app-alb-1274790156.ap-northeast-2.elb.amazonaws.com"

# 기본 health path
HEALTH_PATH="${HEALTH_PATH:-/health}"

# =========================================================
# Remote App / Docker Compose Config
# =========================================================

APP_DIR="${APP_DIR:-/opt/rsp-qa-ai}"

# 기존 스크립트 호환용
COMPOSE="${COMPOSE:-${APP_DIR}/compose.qa.yml}"

# 신규 스크립트 호환용
COMPOSE_FILE="${COMPOSE_FILE:-${COMPOSE}}"

ENV_FILE="${ENV_FILE:-${APP_DIR}/.image.env}"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-rsp-qa-ai}"

# =========================================================
# Service Health Check Config
# 형식:
#   "서비스명:외부포트:타겟그룹명"
#
# 기존 health-check.sh 에서:
#   IFS=':' read -r name port _tg <<< "$entry"
# 형태로 사용하므로 세 번째 값은 없어도 됨.
#
# 포트가 실제 compose / ALB listener 포트와 다르면 여기만 수정.
# =========================================================

SERVICES=(
    "event_receiver:3001:"
    "event_analyzer:3002:"
    "action_runner:3004:"
    "report_manager:3005:"
    "ai_chat_service:3007:"
    "config_manager:3008:"
)

# =========================================================
# Log helpers
# =========================================================

log() {
    echo "[INFO] $*"
}

ok() {
    echo "[ OK ] $*"
}

warn() {
    echo "[WARN] $*"
}

err() {
    echo "[ERROR] $*" >&2
}

# =========================================================
# Checks
# =========================================================

require_aws() {
    command -v aws >/dev/null 2>&1 || {
        err "aws cli 가 필요합니다."
        exit 1
    }

    aws sts get-caller-identity >/dev/null 2>&1 || {
        err "AWS 인증이 없습니다. aws configure 또는 aws sso login 상태를 확인하세요."
        exit 1
    }
}

require_docker() {
    command -v docker >/dev/null 2>&1 || {
        err "docker 가 필요합니다."
        exit 1
    }
}

require_curl() {
    command -v curl >/dev/null 2>&1 || {
        err "curl 이 필요합니다."
        exit 1
    }
}

require_jq() {
    command -v jq >/dev/null 2>&1 || {
        err "jq 가 필요합니다."
        exit 1
    }
}

# =========================================================
# Helpers
# =========================================================

print_config() {
    echo "========================================"
    echo "AWS / ECR Config"
    echo "========================================"
    echo "AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID}"
    echo "AWS_REGION=${AWS_REGION}"
    echo "ECR_REPOSITORY=${ECR_REPOSITORY}"
    echo "ECR_REGISTRY=${ECR_REGISTRY}"
    echo "IMAGE_TAG=${IMAGE_TAG}"
    echo "IMAGE_LOCAL=${IMAGE_LOCAL}"
    echo "IMAGE_REMOTE=${IMAGE_REMOTE}"
    echo "TARGET_PLATFORM=${TARGET_PLATFORM}"
    echo
    echo "========================================"
    echo "Deploy Config"
    echo "========================================"
    echo "ASG_NAME=${ASG_NAME}"
    echo "ALB_DNS=${ALB_DNS}"
    echo "APP_DIR=${APP_DIR}"
    echo "COMPOSE=${COMPOSE}"
    echo "COMPOSE_FILE=${COMPOSE_FILE}"
    echo "ENV_FILE=${ENV_FILE}"
    echo "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}"
    echo "HEALTH_PATH=${HEALTH_PATH}"
    echo "========================================"
}

find_inservice_instance() {
    require_aws

    aws autoscaling describe-auto-scaling-groups \
        --auto-scaling-group-names "$ASG_NAME" \
        --region "$AWS_REGION" \
        --query "AutoScalingGroups[0].Instances[?LifecycleState=='InService'].InstanceId | [0]" \
        --output text
}

require_alb_dns() {
    if [[ -z "${ALB_DNS:-}" ]]; then
        err "ALB_DNS 값이 비어 있습니다."
        err "config.sh 에 ALB_DNS 를 설정하거나 아래처럼 실행하세요."
        err "ALB_DNS=xxx.ap-northeast-2.elb.amazonaws.com ./scripts/aws/health-check.sh"
        exit 1
    fi
}