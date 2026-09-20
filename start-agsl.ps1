# AGSL 一键启动脚本
# 用法：双击 start-agsl.bat，或在 PowerShell 里运行 .\start-agsl.ps1
$ErrorActionPreference = 'Stop'

$root        = $PSScriptRoot
$backend     = Join-Path $root 'scheduled-tasks-backend'
$frontend    = $root
$serverLog   = Join-Path $backend 'server.log'

# ---------- 检查 Node ----------
try {
  $nodeVer = node --version
} catch {
  Write-Host '[ERROR] Node.js 未安装，请先安装 Node.js 18+ (https://nodejs.org)' -ForegroundColor Red
  Write-Host '按任意键退出...' -ForegroundColor DarkGray
  $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
  exit 1
}

Clear-Host
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '   AGSL 启动器' -ForegroundColor Cyan
Write-Host "   Node.js: $nodeVer" -ForegroundColor Gray
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''

# ---------- 第一次：装后端依赖 ----------
if (-not (Test-Path (Join-Path $backend 'node_modules'))) {
  Write-Host '[...] 后端依赖未安装，开始安装（首次会比较久）...' -ForegroundColor Yellow
  Push-Location $backend
  & npm install
  Pop-Location
  if ($LASTEXITCODE -ne 0) {
    Write-Host '[ERROR] 后端依赖安装失败' -ForegroundColor Red
    pause; exit 1
  }
}

# ---------- 清理旧进程（端口 5180） ----------
Get-NetTCPConnection -LocalPort 5180 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host "[...] 清理旧后端 PID $($_.OwningProcess)" -ForegroundColor DarkYellow
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }

# ---------- 启动后端（隐藏窗口） ----------
Write-Host '[...] 启动后端 (http://127.0.0.1:5180)' -ForegroundColor Cyan
$backendProc = Start-Process -FilePath 'node' `
  -ArgumentList 'server.js' `
  -WorkingDirectory $backend `
  -RedirectStandardOutput $serverLog `
  -RedirectStandardError "$serverLog.err" `
  -WindowStyle Hidden `
  -PassThru
Write-Host "  后端 PID $($backendProc.Id)，日志：$serverLog" -ForegroundColor Gray

# 等后端就绪（最多 15s）
$backendReady = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $null = Invoke-WebRequest -Uri 'http://127.0.0.1:5180/api/status' -TimeoutSec 1
    $backendReady = $true; break
  } catch {}
}
if ($backendReady) { Write-Host '[OK] 后端就绪' -ForegroundColor Green }
else { Write-Host '[!] 后端启动超时，请查看日志' -ForegroundColor Yellow }

# ---------- 启动前端（独立窗口） ----------
Write-Host '[...] 启动 Vite dev server (http://localhost:5173)' -ForegroundColor Cyan
$frontendProc = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/k', 'title AGSL-Vite & npm run dev' `
  -WorkingDirectory $frontend `
  -PassThru
Write-Host "  前端 PID $($frontendProc.Id)" -ForegroundColor Gray

# 等前端就绪（最多 30s）
$frontendReady = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $null = Invoke-WebRequest -Uri 'http://localhost:5173' -TimeoutSec 1
    $frontendReady = $true; break
  } catch {}
}
if ($frontendReady) {
  Write-Host '[OK] 前端就绪' -ForegroundColor Green
  Start-Process 'http://localhost:5173'
} else {
  Write-Host '[!] 前端启动超时，等手动打开 http://localhost:5173' -ForegroundColor Yellow
}

# ---------- 保存 PID，停的时候用 ----------
@{
  backend  = $backendProc.Id
  frontend = $frontendProc.Id
  startedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content (Join-Path $root '.agsl-pids.json')

Write-Host ''
Write-Host '============================================' -ForegroundColor Cyan
Write-Host '   AGSL 已启动' -ForegroundColor Green
Write-Host '   前端：http://localhost:5173'  -ForegroundColor White
Write-Host '   后端：http://127.0.0.1:5180'   -ForegroundColor White
Write-Host ''
Write-Host '   关掉那个 AGSL-Vite 窗口即可停前端 + 后端' -ForegroundColor DarkGray
Write-Host '   或者跑 .\stop-agsl.bat 全部停止' -ForegroundColor DarkGray
Write-Host '============================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '按任意键关闭此窗口（10 秒后自动关闭）...' -ForegroundColor DarkGray
$end = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $end) {
  if ($Host.UI.RawUI.KeyAvailable) {
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    break
  }
  Start-Sleep -Milliseconds 200
}
