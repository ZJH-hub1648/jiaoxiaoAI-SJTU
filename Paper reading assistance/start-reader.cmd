@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer first.
  pause
  exit /b 1
)
if not exist "node_modules\pdfjs-dist\build\pdf.mjs" (
  echo Please run npm ci in this skill folder first.
  pause
  exit /b 1
)
node "%~dp0server.mjs" %*
if errorlevel 1 pause
