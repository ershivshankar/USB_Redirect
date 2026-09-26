@echo off
title WebUSB Remote UnlockTool Auto-Bridge
color 0B

echo ======================================================================
echo    ⚡ WebUSB Remote UnlockTool Auto-Bridge ⚡
echo    Cloud Relay: wss://usb-jd78.onrender.com
echo ======================================================================
echo.

:: 1. Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [!] Node.js is required to run the local cloud bridge.
    echo [*] Please ensure Node.js is in your PATH.
    pause
    exit /b 1
)

:: 2. Launch Local Cloud Bridge in background
echo [*] Starting Local Cloud Bridge Listener on 127.0.0.1:9008...
start /B node "%~dp0local_bridge.js" > "%~dp0bridge_runtime.log" 2>&1

:: Wait 2 seconds for WebSocket handshake
timeout /t 2 /nobreak >nul

echo [+] Bridge is ACTIVE & connected to Render Cloud!
echo [+] Listening for remote phone packets (Vivo, Samsung, Xiaomi, etc.)
echo.
echo ======================================================================
echo  📱 READY IN UNLOCKTOOL:
echo  1. Open UnlockTool
echo  2. Select your Brand & Model (e.g. VIVO -> Y15 / Y12)
echo  3. Select Port: COM4 / 127.0.0.1:9008
echo  4. Click [BROM] / [EDL] Unlock!
echo ======================================================================
echo.

:: 3. Launch UnlockTool if present
if exist "F:\PU\UnlockTool_Clean_Project\UnlockToolPRO.exe" (
    echo [*] Launching UnlockTool PRO...
    start "" "F:\PU\UnlockTool_Clean_Project\UnlockToolPRO.exe"
) else (
    echo [i] UnlockTool is ready to run.
)

echo [i] Keep this window open while servicing remote phones.
echo.
pause
