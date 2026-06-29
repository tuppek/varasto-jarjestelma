#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d "backend/.venv" ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -r backend/requirements.txt
fi

if [ ! -f "frontend/icons/icon-192.png" ]; then
  python3 scripts/generate_icons.py
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "???")

echo ""
echo "  Varastojärjestelmä – VERKKOTILA"
echo "  Tämä kone:     http://127.0.0.1:8000"
echo "  Puhelin/WiFi:  http://${IP}:8000"
echo ""
echo "  Android: Chrome → ⋮ → Lisää aloitusnäytölle"
echo ""

backend/.venv/bin/uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
