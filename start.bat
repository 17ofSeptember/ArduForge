@echo off
REM Windows. Double-click, or run from a terminal.
REM All the logic is in scripts\start.mjs; this only finds it and runs it.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node was not found.
  echo.
  echo   Install Node 22 or newer from https://nodejs.org, or with winget:
  echo       winget install OpenJS.NodeJS.LTS
  echo.
  echo   You may need to open a new terminal afterwards so PATH updates.
  echo.
  pause
  exit /b 1
)

node scripts\start.mjs
set STATUS=%ERRORLEVEL%

REM A double-clicked window closes on exit and takes the error with it.
if not "%STATUS%"=="0" (
  echo.
  echo   ArduForge exited with status %STATUS%.
  pause
)
exit /b %STATUS%
