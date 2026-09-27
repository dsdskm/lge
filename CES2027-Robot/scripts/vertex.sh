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

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required in env/.env.local}"
: "${GOOGLE_APPLICATION_CREDENTIALS:?GOOGLE_APPLICATION_CREDENTIALS is required in env/.env.local}"

if [[ "${GOOGLE_APPLICATION_CREDENTIALS}" != /* ]]; then
  GOOGLE_APPLICATION_CREDENTIALS="${ROOT_DIR}/${GOOGLE_APPLICATION_CREDENTIALS}"
fi

: "${VERTEX_LOCATION:=us-central1}"
: "${VERTEX_EMBEDDING_MODEL:=text-embedding-005}"
: "${VERTEX_CHAT_MODEL:=gemini-2.0-flash-001}"

if [[ ! -f "${GOOGLE_APPLICATION_CREDENTIALS}" ]]; then
  echo "Service account file not found: ${GOOGLE_APPLICATION_CREDENTIALS}" >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required to obtain a Vertex AI access token." >&2
  exit 1
fi

export GOOGLE_APPLICATION_CREDENTIALS
ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"
VERTEX_BASE="https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models"

printf '%s\n' "== Vertex AI Embedding test =="
printf 'Project: %s\nLocation: %s\nModel: %s\n' "${GCP_PROJECT_ID}" "${VERTEX_LOCATION}" "${VERTEX_EMBEDDING_MODEL}"

embedding_response="$(curl --fail-with-body -sS -X POST "${VERTEX_BASE}/${VERTEX_EMBEDDING_MODEL}:predict" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"instances":[{"content":"CES2027 Robot Vertex AI embedding test"}]}' )"

if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "${embedding_response}" | jq '{model: .deployedModelId, dimensions: (.predictions[0].embeddings.values | length), statistics: .predictions[0].embeddings.statistics}'
else
  printf '%s\n' "${embedding_response}"
fi

printf '%s\n' "== Vertex AI Gemini test =="
printf 'Model: %s\n' "${VERTEX_CHAT_MODEL}"

chat_response="$(curl --fail-with-body -sS -X POST "${VERTEX_BASE}/${VERTEX_CHAT_MODEL}:generateContent" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"role":"user","parts":[{"text":"CES2027 Robot Vertex AI 연결 테스트입니다. 한 문장으로 응답하세요."}]}]}' )"

if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "${chat_response}" | jq -r '.candidates[0].content.parts[0].text // .error.message // .'
else
  printf '%s\n' "${chat_response}"
fi
