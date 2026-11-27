@echo off
title Installation de Jarvis
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\install.ps1" %*
if errorlevel 1 (
  echo.
  echo L'installation a echoue. Lis le message ci-dessus.
)
pause
