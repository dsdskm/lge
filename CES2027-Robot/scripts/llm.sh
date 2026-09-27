#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/env/.env.local"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required." >&2
  exit 1
fi

DEFAULT_SCHEME="http"
if [[ -n "${SSL_CRT_FILE:-}" ]]; then
  DEFAULT_SCHEME="https"
fi
API_BASE="${LLM_API_BASE:-${DEFAULT_SCHEME}://localhost:${PORT:-3978}}"
QUESTION_FILE="${LLM_QUESTION_FILE:-${ROOT_DIR}/scripts/question.txt}"
QUESTION="$(tr '\n' ' ' < "${QUESTION_FILE}" | sed 's/[[:space:]]*$//')"
FOLDER_ID="${LLM_FOLDER_ID:-}"

if [[ -z "${QUESTION}" ]]; then
  echo "Question file is empty: ${QUESTION_FILE}" >&2
  exit 1
fi

if [[ -z "${FOLDER_ID}" ]]; then
  workspace="$(curl -k --fail-with-body -sS "${API_BASE}/api/workspace")"
  FOLDER_ID="$(printf '%s' "${workspace}" | jq -r '.folders[0].id // empty')"
fi

if [[ -z "${FOLDER_ID}" ]]; then
  echo "No folder found. Create a folder or pass its ID as the second argument." >&2
  exit 1
fi

payload="$(jq -n --arg folderId "${FOLDER_ID}" --arg question "${QUESTION}" '{folderId: $folderId, question: $question}')"
response="$(curl -k --fail-with-body -sS -X POST "${API_BASE}/api/chat" \
  -H 'Content-Type: application/json' \
  -d "${payload}")"

printf '%s\n' "${response}" | jq '{answer, sources}'
