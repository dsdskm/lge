#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="ces2027-postgres"
IMAGE="pgvector/pgvector:pg16"
DB_NAME="ces2027"
DB_USER="root"
DB_PASSWORD="root"
DB_PORT="5432"
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:${DB_PORT}/${DB_NAME}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Start Docker Desktop and run this script again." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop and run this script again." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
  if ! docker ps --format '{{.Names}}' | grep -Fxq "${CONTAINER_NAME}"; then
    docker start "${CONTAINER_NAME}" >/dev/null
  fi
else
  docker run --name "${CONTAINER_NAME}" \
    -e "POSTGRES_USER=${DB_USER}" \
    -e "POSTGRES_PASSWORD=${DB_PASSWORD}" \
    -e "POSTGRES_DB=${DB_NAME}" \
    -p "${DB_PORT}:5432" \
    -d "${IMAGE}" >/dev/null
fi

echo "Waiting for PostgreSQL..."
until docker exec "${CONTAINER_NAME}" pg_isready >/dev/null 2>&1; do
  sleep 1
done

CONTAINER_DB_USER=$(docker inspect "${CONTAINER_NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^POSTGRES_USER=//p')
docker exec "${CONTAINER_NAME}" psql -v ON_ERROR_STOP=1 -U "${CONTAINER_DB_USER}" -d postgres \
  -c "DO \$\$ BEGIN CREATE ROLE ${DB_USER} LOGIN SUPERUSER PASSWORD '${DB_PASSWORD}'; EXCEPTION WHEN duplicate_object THEN ALTER ROLE ${DB_USER} LOGIN SUPERUSER PASSWORD '${DB_PASSWORD}'; END \$\$;"
docker exec -i "${CONTAINER_NAME}" psql -v ON_ERROR_STOP=1 -U "${DB_USER}" -d "${DB_NAME}" < db/schema.sql

echo "PostgreSQL is ready: ${DATABASE_URL}"
