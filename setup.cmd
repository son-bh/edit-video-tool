@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
exit /b %ERRORLEVEL%
