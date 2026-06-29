#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d "backend/.venv" ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -r backend/requirements.txt
fi

echo ""
echo "  Varastojärjestelmä käynnissä:"
echo "  → http://127.0.0.1:8000"
echo ""
echo "  Paina Ctrl+C lopettaaksesi"
echo ""

backend/.venv/bin/uvicorn main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
