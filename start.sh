#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# create venv if missing
if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python -m venv .venv
fi

# install / update deps
.venv/bin/pip install -q -r requirements.txt

echo "Starting Student Companion at http://localhost:8000"
.venv/bin/uvicorn main:app --reload --port 8000 &
SERVER_PID=$!
sleep 1
xdg-open http://localhost:8000
wait $SERVER_PID
