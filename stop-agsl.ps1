# AGSL 一键停止
$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot

Write-Host '[...] 关闭 AGSL' -ForegroundColor Cyan

# 1) 根据端口找进程杀
Get-NetTCPConnection -LocalPort 5180,5173 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object {
    Write-Host "  终止 PID $($_.OwningProcess) (端口 $($_.LocalPort))" -ForegroundColor DarkYellow
    try { Stop-Process -Id $_.OwningProcess -Force } catch {}
  }

# 2) 根据记录的 PID 杀（start-agsl.ps1 写过）
$pidFile = Join-Path $root '.agsl-pids.json'
if (Test-Path $pidFile) {
  $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
  foreach ($name in 'backend', 'frontend') {
    $id = $pids.$name
    if ($id) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host "  终止 $name PID $id" -ForegroundColor DarkYellow
        try { $p.Kill() } catch {}
      }
    }
  }
  Remove-Item $pidFile -Force
}

# 3) 关掉所有标题以 AGSL 开头的 cmd 窗口
Get-Process -Name 'cmd' -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -like 'AGSL*' } |
  ForEach-Object {
    Write-Host "  关窗口 PID $($_.Id) 标题=$($_.MainWindowTitle)" -ForegroundColor DarkYellow
    try { $_.Kill() } catch {}
  }

Write-Host '[OK] AGSL 已停止' -ForegroundColor Green
Write-Host '按任意键关闭（10 秒后自动关闭）...' -ForegroundColor DarkGray
$end = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $end) {
  if ($Host.UI.RawUI.KeyAvailable) {
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    break
  }
  Start-Sleep -Milliseconds 200
}
