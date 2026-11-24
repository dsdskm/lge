#!/usr/bin/env bash
set -euo pipefail

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is required to find processes listening on a port." >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required to read project port settings." >&2
    exit 1
  fi

  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  node_args=()
  if [[ -f "$repo_root/.env" ]]; then
    node_args+=("--env-file=$repo_root/.env")
  fi
  configured_ports="$(node "${node_args[@]}" -e '
    const defaults = [
      ["API_PORT", "4310"],
      ["PLANNING_AGENT_PORT", "4324"],
      ["DESIGN_AGENT_PORT", "4321"],
      ["SIMULATION_AGENT_PORT", "4323"],
      ["IMPLEMENTATION_AGENT_PORT", "4325"],
      ["VALIDATION_AGENT_PORT", "4322"],
      ["POSTGRES_PORT", "5432"],
    ];
    const ports = defaults.map(([key, fallback]) => {
      const value = process.env[key] || fallback;
      if (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
        console.error(`Invalid ${key}: ${value}`);
        process.exit(1);
      }
      return value;
    });
    console.log(["5173", ...ports].join(" "));
  ')"
  read -r -a ports <<< "$configured_ports"
else
  ports=("$@")
fi

normalized_ports=()
for port in "${ports[@]}"; do
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    echo "Invalid port: $port" >&2
    exit 1
  fi
  while [[ "$port" == 0* && ${#port} -gt 1 ]]; do
    port="${port#0}"
  done
  if (( ${#port} > 5 || port < 1 || port > 65535 )); then
    echo "Invalid port: $port" >&2
    exit 1
  fi
  normalized_ports+=("$port")
done

for port in "${normalized_ports[@]}"; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -z "$pids" ]]; then
    echo "No process is listening on port $port."
    continue
  fi

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid"
    echo "Stopped process $pid on port $port."
  done <<< "$pids"
done
