@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer first.
  pause
  exit /b 1
)
if not exist node_modules (
  set ELECTRON_SKIP_BINARY_DOWNLOAD=1
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/local-start.mjs
if errorlevel 1 pause
