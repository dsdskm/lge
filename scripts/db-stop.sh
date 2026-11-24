#!/usr/bin/env bash
set -euo pipefail

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

brew services stop "$formula"
