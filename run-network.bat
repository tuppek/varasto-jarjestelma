@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv" (
  echo Luodaan Python-ymparisto...
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -r backend\requirements.txt
)

if not exist "frontend\icons\icon-192.png" (
  python scripts\generate_icons.py
)

echo.
echo  ========================================
echo   Varastojarjestelma - VERKKOTILA
echo  ========================================
echo.
echo  Tama kone (selain):
echo    http://127.0.0.1:8000
echo.
echo  Android / muut laitteet samassa WiFi:ssa:
echo    http://[TAMAN-KONEEN-IP]:8000
echo.
echo  IP-osoite (Windows):
ipconfig | findstr /i "IPv4"
echo.
echo  Asenna puhelimeen: Chrome - Kolme pistetta - Lisaa aloitusnayttolle
echo  Tai kayta: run-network-https.bat (kameraskannaus + asenna sovellus)
echo.
echo  Paina Ctrl+C lopettaaksesi
echo.

backend\.venv\Scripts\uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
