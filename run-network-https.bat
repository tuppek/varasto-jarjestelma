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

if not exist "cert\cert.pem" (
  python scripts\make_https_cert.py
)

echo.
echo  ========================================
echo   Varastojarjestelma - HTTPS / Android
echo  ========================================
echo.
echo  Android (suositus):
ipconfig | findstr /i "IPv4"
echo    https://[YLLA-OLEVA-IP]:8443
echo.
echo  Hyvaksy sertifikaatti-varoitus ensimmaisella kerralla.
echo  Sen jälkeen: Chrome - Asenna sovellus
echo.

backend\.venv\Scripts\uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8443 --reload --ssl-keyfile cert/key.pem --ssl-certfile cert/cert.pem
