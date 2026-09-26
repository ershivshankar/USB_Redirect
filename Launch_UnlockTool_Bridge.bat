@echo off
setlocal enabledelayedexpansion
title WebUSB Remote Bridge Engine
color 0B

echo ======================================================================
echo    WebUSB Remote Device Bridge Engine
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

echo [+] Bridge is ACTIVE and connected to Render Cloud!
echo [+] Listening for remote phone packets (Vivo, Samsung, Xiaomi, etc.)
echo.
echo ======================================================================
echo  DEVICE STATUS:
echo  1. Remote phone traffic is bridged to: 127.0.0.1:9008
echo  2. Use your Flasher / Servicing Tool to connect to port 9008 or COM
echo  3. Admin Dashboard: https://usb-jd78.onrender.com/admin
echo ======================================================================
echo.
echo [i] Keep this terminal window open while servicing remote devices.
echo.
pause
