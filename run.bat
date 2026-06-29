@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv" (
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -r backend\requirements.txt
)

if not exist "frontend\icons\icon-192.png" (
  python scripts\generate_icons.py
)

echo.
echo  Varastojarjestelma: http://127.0.0.1:8000
echo  Paina Ctrl+C lopettaaksesi
echo.

backend\.venv\Scripts\uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
