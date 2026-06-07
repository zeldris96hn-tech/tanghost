@echo off
REM ╔══════════════════════════════════════════════════════════╗
REM ║  TanGhost — Arranque automático de servidores            ║
REM ║  Doble clic para iniciar. Se minimiza solo.              ║
REM ╚══════════════════════════════════════════════════════════╝

REM Ir a la carpeta donde está este .bat
cd /d "%~dp0"

REM Arrancar servidor Pokémon (puerto 7331)
start /min "TanGhost Pokemon Bridge" node pokemon-server.js

REM Arrancar servidor Chat Overlay (puerto 7332)
start /min "TanGhost Chat Bridge" node chat-server.js

REM Arrancar servidor Gifter Overlay (puerto 7333)
start /min "TanGhost Gifter Bridge" node gifter-server.js

REM Mensaje rápido y cierra
echo [TanGhost] Servidores iniciados:
echo   Puerto 7331 - Pokemon Bridge
echo   Puerto 7332 - Chat Bridge
echo   Puerto 7333 - Gifter Bridge
timeout /t 3 /nobreak >nul
exit
