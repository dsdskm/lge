#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-3978}"
SIGNAL="TERM"

if [[ "${2:-}" == "--force" ]]; then
  SIGNAL="KILL"
fi

if ! [[ "${PORT}" =~ ^[0-9]+$ ]]; then
  echo "Usage: $0 [port] [--force]" >&2
  exit 1
fi

PIDS=$(lsof -ti "TCP:${PORT}" -sTCP:LISTEN || true)

if [[ -z "${PIDS}" ]]; then
  echo "No process is listening on port ${PORT}."
  exit 0
fi

echo "Stopping process(es) on port ${PORT}: ${PIDS}"
kill "-${SIGNAL}" ${PIDS}