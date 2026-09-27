#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="ces2027-postgres"
DB_NAME="ces2027"
DB_USER="root"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-name>   (e.g. $0 db_20260927212133)" >&2
  exit 1
fi

BACKUP_NAME="${1%.dump}"
BACKUP_FILE="${BACKUP_DIR}/${BACKUP_NAME}.dump"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and run this script again." >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  echo "Container ${CONTAINER_NAME} is not running. Run scripts/db.sh first." >&2
  exit 1
fi

echo "This will DROP all current data in '${DB_NAME}' and restore from ${BACKUP_NAME}."
read -r -p "Continue? [y/N] " answer
if [[ "${answer}" != "y" && "${answer}" != "Y" ]]; then
  echo "Aborted."
  exit 1
fi

# Disconnect other sessions so the database can be recreated.
docker exec "${CONTAINER_NAME}" psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" >/dev/null

docker exec "${CONTAINER_NAME}" psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d postgres \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};"
docker exec "${CONTAINER_NAME}" psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d postgres \
  -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

docker exec -i "${CONTAINER_NAME}" pg_restore -U "${DB_USER}" -d "${DB_NAME}" --no-owner --exit-on-error < "${BACKUP_FILE}"

echo "Restored '${DB_NAME}' from ${BACKUP_NAME}"
