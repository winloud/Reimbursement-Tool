@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build_local.ps1" -Mode Test -OpenOutput %*
set "BUILD_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %BUILD_EXIT%
