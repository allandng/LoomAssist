#!/usr/bin/env bash
# Start the LoomAssist backend (FastAPI) on macOS / Linux.
#
# Creates backend-api/venv if it is missing, installs requirements.txt, then
# runs uvicorn on 127.0.0.1:8000. Idempotent: safe to re-run.
#
# Usage:
#   ./run.sh                 # production-style start
#   ./run.sh --reload        # dev start with auto-reload
#   ./run.sh --port 8010     # custom port
#   ./run.sh --skip-install  # skip pip install (faster restarts)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

RELOAD=""
PORT="8000"
HOST="127.0.0.1"
SKIP_INSTALL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reload)        RELOAD="--reload"; shift ;;
    --port)          PORT="$2"; shift 2 ;;
    --host)          HOST="$2"; shift 2 ;;
    --skip-install)  SKIP_INSTALL="1"; shift ;;
    -h|--help)       sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# Pick a python: prefer python3, fall back to python.
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi

if [[ ! -x "venv/bin/python" ]]; then
  echo "[run.sh] Creating virtual environment in $HERE/venv ..."
  "$PY" -m venv venv
fi

VENV_PY="venv/bin/python"

if [[ -z "$SKIP_INSTALL" ]]; then
  echo "[run.sh] Installing requirements ..."
  "$VENV_PY" -m pip install --upgrade pip --quiet
  "$VENV_PY" -m pip install -r requirements.txt --quiet
fi

echo "[run.sh] Starting LoomAssist backend on http://$HOST:$PORT (reload=${RELOAD:-off})"
exec "$VENV_PY" -m uvicorn main:app --host "$HOST" --port "$PORT" $RELOAD
