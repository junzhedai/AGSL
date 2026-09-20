@echo off
rem ============================================================
rem  AGSL one-click launcher (pure CMD)
rem  Double-click to start.
rem ============================================================
setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%scheduled-tasks-backend"
set "FRONTEND_DIR=%SCRIPT_DIR%"

echo.
echo ============================================================
echo    AGSL launcher
echo ============================================================
echo.

rem ---------- check Node.js ----------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ first.
  echo         https://nodejs.org
  goto :fatal
)
for /f "delims=" %%v in ('node --version 2^>nul') do echo [INFO] Node.js: %%v

rem ---------- first run: install backend deps ----------
if exist "%BACKEND_DIR%\node_modules" goto :deps_ok
echo [INSTALL] backend dependencies (first run only) ...
pushd "%BACKEND_DIR%"
call npm install
set "RC=!errorlevel!"
popd
if not "!RC!"=="0" (
  echo [ERROR] npm install failed (exit !RC!)
  goto :fatal
)
echo [INFO] backend dependencies installed.
:deps_ok

rem ---------- clean stale processes on ports 5180 / 5173 ----------
rem Use PowerShell Get-NetTCPConnection for precision (no false matches).
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 5180,5173 -State Listen -ErrorAction SilentlyContinue | Sort-Object OwningProcess -Unique | ForEach-Object { $pid = $_.OwningProcess; try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; Write-Host ('   kill stale PID ' + $pid) } catch {} } } catch { exit 0 }; exit 0"

rem ---------- start backend (hidden window, log to file) ----------
echo.
echo [START] backend (http://127.0.0.1:5180) ...
start "" /MIN cmd /c "cd /d "%BACKEND_DIR%" && node server.js > "%BACKEND_DIR%\server.log" 2>&1"

rem ---------- wait backend ready (up to ~30s) ----------
echo [WAIT ] backend becoming ready ...
set "BACKEND_READY=0"
for /l %%i in (1,1,15) do (
  ping -n 2 127.0.0.1 >nul 2>&1
  netstat -ano | findstr /C:":5180 " | findstr "LISTENING" >nul 2>&1 && (
    set "BACKEND_READY=1"
    goto :backend_ok
  )
)
:backend_ok
if "!BACKEND_READY!"=="1" (
  echo [OK   ] backend ready
) else (
  echo [WARN ] backend slow. Check log: %BACKEND_DIR%\server.log
)

rem ---------- start frontend (new window AGSL-Vite) ----------
echo.
echo [START] frontend Vite dev server (http://localhost:5173) ...
start "AGSL-Vite" cmd /K "cd /d "%FRONTEND_DIR%" && title AGSL-Vite && npm run dev"

rem ---------- wait frontend ready (up to ~90s) ----------
echo [WAIT ] frontend becoming ready (first run may take a while) ...
set "FRONTEND_READY=0"
for /l %%i in (1,1,45) do (
  ping -n 2 127.0.0.1 >nul 2>&1
  netstat -ano | findstr /C:":5173 " | findstr "LISTENING" >nul 2>&1 && (
    set "FRONTEND_READY=1"
    goto :frontend_ok
  )
)
:frontend_ok
if "!FRONTEND_READY!"=="1" (
  echo [OK   ] frontend ready
  echo [OPEN ] http://localhost:5173 in browser ...
  start "" "http://localhost:5173"
) else (
  echo [WARN ] frontend slow. Open http://localhost:5173 manually.
)

echo.
echo ============================================================
echo    AGSL is running
echo    frontend: http://localhost:5173
echo    backend : http://127.0.0.1:5180
echo.
echo    Close AGSL-Vite window to stop frontend.
echo    Run stop-agsl.bat to stop both.
echo ============================================================
echo This window will close automatically in 15 seconds ...
ping -n 16 127.0.0.1 >nul 2>&1
exit /b 0

:fatal
echo.
echo Startup aborted. Closing in 15 seconds ...
ping -n 16 127.0.0.1 >nul 2>&1
exit /b 1
