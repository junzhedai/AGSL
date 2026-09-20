@echo off
rem ============================================================
rem  AGSL one-click stop
rem ============================================================
setlocal EnableDelayedExpansion

echo.
echo [STOP ] AGSL
echo.

rem ---------- kill by port (PowerShell for precision, no false matches) ----------
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort 5180,5173 -State Listen -ErrorAction SilentlyContinue | Sort-Object OwningProcess -Unique | ForEach-Object { $pid = $_.OwningProcess; try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue; Write-Host ('   kill PID ' + $pid) } catch {} } } catch { exit 0 }; exit 0"

rem ---------- kill AGSL-Vite cmd window (by title) ----------
taskkill /F /FI "WINDOWTITLE eq AGSL-Vite*" >nul 2>&1

echo.
echo [OK   ] AGSL stopped
echo This window will close in 10 seconds ...
ping -n 11 127.0.0.1 >nul 2>&1
exit /b 0
