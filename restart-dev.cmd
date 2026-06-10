@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\restart-dev.ps1" %*

if errorlevel 1 (
  echo.
  echo restart-dev failed. Press any key to close.
  pause >nul
  exit /b %errorlevel%
)

endlocal
