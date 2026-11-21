@echo off
setlocal
cd /d "%~dp0"
title 交小AI 校园技能安装向导
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo 未找到 Node.js 22 或更高版本。
  echo 请先从 https://nodejs.org/ 安装 Node.js，然后重新打开本程序。
  echo.
  pause
  exit /b 1
)
node "%~dp0installer\server.mjs"
if errorlevel 1 pause
