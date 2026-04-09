@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [setup] Failed with exit code %EXIT_CODE%.
  echo [setup] Press any key to close this window.
  pause >nul
)

exit /b %EXIT_CODE%
