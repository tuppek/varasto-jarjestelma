@echo off
setlocal
cd /d "%~dp0"

if not exist "backend\.venv" (
  python -m venv backend\.venv
  backend\.venv\Scripts\pip install -r backend\requirements.txt
)

where cloudflared >nul 2>&1
if errorlevel 1 (
  echo.
  echo  cloudflared puuttuu. Asenna se:
  echo    winget install Cloudflare.cloudflared
  echo  tai lataa: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
  echo.
  pause
  exit /b 1
)

echo.
echo  ========================================
echo   Varastojarjestelma - INTERNET-TUNNELI
echo  ========================================
echo.
echo  Kayttaa mobiilidataa / toimii ilman WiFi-reititinta.
echo  Windows tarvitsee minkä tahansa internet-yhteyden
echo  ^(puhelimen USB-jakaminen riittaa^).
echo.
echo  Kaynnistetaan palvelin + Cloudflare-tunneli...
echo  Odota hetki - alla nakyva https://....trycloudflare.com -osoite
echo  on se minkä avaat puhelimella ^(mobiilidata ok^).
echo.
echo  Paina Ctrl+C lopettaaksesi molemmat.
echo.

start "varasto-server" /min cmd /c "backend\.venv\Scripts\uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000"

timeout /t 2 /nobreak >nul
cloudflared tunnel --url http://127.0.0.1:8000

taskkill /fi "WINDOWTITLE eq varasto-server" /f >nul 2>&1
