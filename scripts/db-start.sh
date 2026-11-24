#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to manage the local PostgreSQL service." >&2
  exit 1
fi

formula="${POSTGRES_FORMULA:-}"
if [[ -z "$formula" ]]; then
  formula="$(
    brew list --formula |
      awk '/^postgresql@[0-9]+$/ { print }' |
      sort -t@ -k2,2n |
      tail -n 1
  )"
  if [[ -z "$formula" ]] && brew list --formula | grep -qx 'postgresql'; then
    formula="postgresql"
  fi
fi

if [[ -z "$formula" ]] || ! brew list --formula "$formula" >/dev/null 2>&1; then
  echo "No installed PostgreSQL formula found. Set POSTGRES_FORMULA to an installed formula." >&2
  exit 1
fi

brew services start "$formula"

read_config() {
  local key="$1"
  local fallback="$2"
  local value="${!key:-}"
  if [[ -z "$value" && -f "$repo_root/.env" ]]; then
    value="$(node --env-file="$repo_root/.env" -e 'process.stdout.write(process.env[process.argv[1]] ?? "")' "$key")"
  fi
  printf '%s' "${value:-$fallback}"
}

if ! command -v pg_isready >/dev/null 2>&1 || ! command -v createdb >/dev/null 2>&1 || ! command -v psql >/dev/null 2>&1; then
  echo "PostgreSQL client tools (pg_isready, createdb and psql) are required." >&2
  exit 1
fi

db_host="$(read_config POSTGRES_HOST 127.0.0.1)"
db_port="$(read_config POSTGRES_PORT 5432)"
db_name="$(read_config POSTGRES_DB workflow_portal)"
db_user="$(read_config POSTGRES_USER "$(id -un)")"
db_password="$(read_config POSTGRES_PASSWORD "")"

if [[ ! "$db_name" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "POSTGRES_DB must be a PostgreSQL identifier (letters, digits and underscores)." >&2
  exit 1
fi

export PGHOST="$db_host" PGPORT="$db_port" PGUSER="$db_user"
if [[ -n "$db_password" ]]; then
  export PGPASSWORD="$db_password"
fi

for _ in {1..30}; do
  if pg_isready -q; then
    break
  fi
  sleep 1
done

if ! pg_isready -q; then
  echo "PostgreSQL did not become ready at $db_host:$db_port." >&2
  exit 1
fi

existing_database="$(
  psql --dbname=postgres --tuples-only --no-align \
    --command="SELECT 1 FROM pg_database WHERE datname = '$db_name'"
)"
if [[ "$existing_database" != "1" ]]; then
  createdb --maintenance-db=postgres "$db_name"
fi
echo "PostgreSQL database '$db_name' is ready."
