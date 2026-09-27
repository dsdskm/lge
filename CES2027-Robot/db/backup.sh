#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="ces2027-postgres"
DB_NAME="ces2027"
DB_USER="root"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and run this script again." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  echo "Container ${CONTAINER_NAME} is not running. Run scripts/db.sh first." >&2
  exit 1
fi

BACKUP_NAME="db_$(date +%Y%m%d%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.dump"

mkdir -p "${BACKUP_DIR}"

docker exec "${CONTAINER_NAME}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc > "${BACKUP_FILE}"

echo "Backup created: ${BACKUP_FILE}"
echo "Restore with: ./db/restore.sh ${BACKUP_NAME}"
