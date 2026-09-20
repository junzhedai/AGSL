// 启动外部程序 + 就绪检测
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logInfo, logError, logWarn } from './logger.js';

const execFileP = promisify(execFile);

// ========== 各应用的启动器 ==========
// 每个 launcher(program, step) -> { process, readyPromise }

export const LAUNCHERS = {
  async generic(program, step) {
    const args = (step.args || []).slice();
    const child = spawn(program.path, args, {
      detached: false,
      shell: false,
      windowsHide: false,
    });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // MuMu 12: player.exe 启动后会自动打开 MuMuPlayer.exe 主界面
  async mumu12(program, step) {
    const args = [];
    if (step.mumuIndex != null) args.push('-p', String(step.mumuIndex));
    const child = spawn(program.path, args, { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // Mock 模拟器 (供 mock-emulator.ps1 用): spawn 后等 stdout 包含特定 marker 才算 ready
  // 默认 marker '启动完成'，可在 step.readyMarker 自定义
  // .cmd 自动转 .ps1 + spawn powershell -File (绕开 cmd.exe /c 参数解析的坑)
  async mock(program, step) {
    const args = [];
    if (step.title) args.push('-Title', String(step.title));
    if (step.displayName) args.push('-DisplayName', String(step.displayName));
    if (step.startupMs != null) args.push('-StartupMs', String(step.startupMs));
    if (step.durationMs != null) args.push('-DurationMs', String(step.durationMs));
    if (step.windowX != null) args.push('-WindowX', String(step.windowX));
    if (step.windowY != null) args.push('-WindowY', String(step.windowY));
    if (step.adbSerial) args.push('-Serial', String(step.adbSerial));

    // 自动从 .cmd 找同名 .ps1 (兼容老配置)
    let scriptPath = program.path;
    if (scriptPath.toLowerCase().endsWith('.cmd')) {
      scriptPath = scriptPath.replace(/\.cmd$/i, '.ps1');
    }

    let child;
    if (scriptPath.toLowerCase().endsWith('.ps1')) {
      // PowerShell 路径: 直接 spawn powershell -File (避开 cmd.exe /c 解析坑)
      child = spawn('powershell.exe',
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args],
        { detached: false }
      );
    } else {
      // .exe / 其他: 直接 spawn
      child = spawn(scriptPath, args, { detached: false });
    }
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    const needle = step.readyMarker || '启动完成';
    const timeoutMs = step.waitTimeoutMs || 60000;
    const readyPromise = new Promise((resolve, reject) => {
      let buf = '';
      const onData = (d) => {
        buf += d.toString();
        if (buf.includes(needle)) {
          child.stdout.off('data', onData);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      const t = setTimeout(() => {
        child.stdout.off('data', onData);
        reject(new Error(`mock ready timeout: waiting for "${needle}" in stdout (${timeoutMs}ms)`));
      }, timeoutMs);
      if (typeof t.unref === 'function') t.unref();
    });
    return { process: child, readyPromise };
  },

  // 雷电: dnplayer.exe launchindex <n>
  async ldplayer(program, step) {
    const args = [];
    if (step.ldIndex != null) args.push('launchindex', String(step.ldIndex));
    const child = spawn(program.path, args, { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // BlueStacks 5
  async bluestacks(program, step) {
    const args = [];
    if (step.bsInstance) args.push('--instance', String(step.bsInstance));
    const child = spawn(program.path, args, { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // MAA: 启动 MaaCore.exe 或 maa.exe，参数看你装的版本
  // 常见用法：MaaCore.exe 直接运行；或 maa.exe run
  async maa(program, step) {
    const args = step.cliArgs || [];
    const child = spawn(program.path, args, { detached: false, shell: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // ALAS: alas.exe
  // 关键: --run 参数在 gui.py 里只是 stub（实际未读取），自动跑靠 deploy.yaml 里
  // Webui.Run: ["<config_name>"] 字段。我们用 launch 前临时改 deploy.yaml 的方式触发自动跑。
  // 启动后等 ALAS 完成 deploy update + webui 端口 listen（=真正 ready），然后还原 deploy.yaml。
  async alas(program, step) {
    const args = step.cliArgs || [];

    const alasConfigDir = await getAlasConfigDir(program.path);
    const deployPath = alasConfigDir ? path.join(alasConfigDir, 'deploy.yaml') : null;

    let configName = step.alasConfig;
    if (alasConfigDir) {
      // 统一去掉 .json 后缀（listAlasConfigs 返回的 name 也不带 .json）
      // 然后用 name 在 listAlasConfigs 里校验存在
      if (configName) {
        let base = String(configName).trim();
        if (base.toLowerCase().endsWith('.json')) base = base.slice(0, -5);
        const list = await listAlasConfigs(alasConfigDir);
        const hit = list.find(c => c.name === base);
        if (hit) {
          if (hit.name !== configName) {
            logInfo('launcher', `[${program.name || program.id}] 规范化 ALAS config: ${configName} -> ${hit.name}`);
          }
          configName = hit.name;
        } else {
          logWarn('launcher', `[${program.name || program.id}] step.alasConfig=${configName} 不在 config 列表里，回退到按 taskName 自动匹配`);
          configName = null;
        }
      }
      if (!configName) {
        const found = await findAlasConfig(alasConfigDir, step.taskName);
        if (found) {
          configName = found;
          logInfo('launcher', `[${program.name || program.id}] 自动选择 ALAS config: ${configName}`);
        }
      }
    }
    if (!configName) {
      if (alasConfigDir) {
        logWarn('launcher', `[${program.name || program.id}] 没找到 ALAS user config（仅 template），请先去 ALAS GUI 配任务`);
      }
      // 不指定 config 也允许启动（用户可能想手动 GUI 选），但不会自动跑
    }

    // 临时改 deploy.yaml: 备份整文件 -> 写入 Run: ["<name>"] -> spawn -> 等 ready -> 还原整文件
    let deployBackup = null;
    if (configName && deployPath) {
      try {
        deployBackup = await fs.readFile(deployPath, 'utf-8');
        let rewritten = deployBackup;
        // 用 capture group 保留前导空格（YAML 缩进必须保持一致）
        const m = deployBackup.match(/^(\s*)Run:\s*(.+?)\s*$/m);
        if (m) {
          rewritten = deployBackup.replace(m[0], `${m[1]}Run: ["${configName}"]`);
        } else {
          // 没找到 Run 行，插到 Webui 块里。用 Webui: 行的缩进作基准 + 2 空格
          const webuiM = deployBackup.match(/^(\s*)Webui:\s*\n/m);
          const indent = webuiM ? webuiM[1] + '  ' : '  ';
          rewritten = deployBackup.replace(/(Webui:\s*\n)/, `$1${indent}Run: ["${configName}"]\n`);
        }
        if (rewritten !== deployBackup) {
          await fs.writeFile(deployPath, rewritten, 'utf-8');
          logInfo('launcher', `[${program.name || program.id}] 临时改 deploy.yaml Webui.Run -> ["${configName}"]`);
        }
      } catch (e) {
        logWarn('launcher', `[${program.name || program.id}] 改 deploy.yaml 失败: ${e.message}（ALAS 启动后不会自动跑 config，需手动 GUI 点开始）`);
        configName = null;
        deployBackup = null;
      }
    }

    const child = spawn(program.path, args, { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');

    // ready 检测: 等 ALAS webui 端口 listen（默认 22267）
    const port = step.alasPort || 22267;
    const readyPromise = (async () => {
      try {
        await waitForPort(port, step.waitTimeoutMs || 60000);
      } finally {
        // 还原 deploy.yaml（无论 waitForPort 成功与否都还原，避免污染用户配置）
        if (deployPath && deployBackup !== null) {
          try {
            const current = await fs.readFile(deployPath, 'utf-8');
            if (current !== deployBackup) {
              await fs.writeFile(deployPath, deployBackup, 'utf-8');
              logInfo('launcher', `[${program.name || program.id}] 还原 deploy.yaml`);
            }
          } catch (e) {
            logWarn('launcher', `[${program.name || program.id}] 还原 deploy.yaml 失败: ${e.message}`);
          }
        }
      }
    })();

    return { process: child, readyPromise };
  },

  // BetterGi: 直接启动
  async bettergi(program) {
    const child = spawn(program.path, [], { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // 原神官方启动器 launcher.exe
  async genshin_launcher(program, step) {
    // 一些启动器支持直接传 --game=ys / --start 直接进入游戏，自己按需加
    const args = step.launcherArgs || ['--game=ys'];
    const child = spawn(program.path, args, { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // 直接启动 YuanShen.exe（不推荐：绕过头盔版更新）
  async genshin_direct(program) {
    const child = spawn(program.path, [], { detached: false });
    bindLogging(child, program.name || program.displayName || program.id || 'unknown');
    return { process: child, readyPromise: Promise.resolve() };
  },

  // 弹一个 PowerShell WinForms 弹窗，durationMs 到后自动关
  // 用作端到端测试：模拟"游戏已启动"提示 + 自动结束
  async popup(program, step) {
    // 默认用 ASCII 内容，避免 PowerShell WinForms 里的中文编码乱码
    const message = step.message || 'hello world';
    // 优先级：step.popupDurationMs > step.durationMs > step.duration(分钟)*60*1000 > 默认 5 分钟
    let durMs = Number(step.popupDurationMs);
    if (!durMs) durMs = Number(step.durationMs);
    if (!durMs && step.duration) durMs = Number(step.duration) * 60 * 1000;
    if (!durMs) durMs = 300000; // 5 分钟默认
    if (durMs < 500) durMs = 500;
    const safeMsg = String(message).replace(/'/g, "''");
    const psCmd = [
      "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
      "$form = New-Object System.Windows.Forms.Form",
      `$form.Text = 'AGSL popup'`,
      `$form.Size = New-Object System.Drawing.Size(420, 160)`,
      "$form.StartPosition = 'CenterScreen'",
      "$form.TopMost = $true",
      "$form.FormBorderStyle = 'FixedDialog'",
      "$label = New-Object System.Windows.Forms.Label",
      `$label.Text = '${safeMsg}'`,
      "$label.Dock = 'Fill'",
      "$label.TextAlign = 'MiddleCenter'",
      "$label.Font = New-Object System.Drawing.Font('Consolas', 14)",
      "$form.Controls.Add($label)",
      "$timer = New-Object System.Windows.Forms.Timer",
      `$timer.Interval = ${durMs}`,
      "$timer.Add_Tick({ $timer.Stop(); $form.Close() })",
      "$timer.Start()",
      "[void]$form.ShowDialog()",
      "exit 0",
    ].join(' ; ');
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
      detached: false,
    });
    bindLogging(child, 'popup');
    return { process: child, readyPromise: Promise.resolve() };
  },
};

export function pickLauncher(programType) {
  return LAUNCHERS[programType] || LAUNCHERS.generic;
}

// ========== 就绪检测 ==========

async function isProcessRunning(processName) {
  try {
    const { stdout } = await execFileP(
      'tasklist',
      ['/FI', `IMAGENAME eq ${processName}`, '/FO', 'LIST', '/NH'],
      { windowsHide: true }
    );
    // 没匹配时 tasklist 输出包含 "INFO: No tasks are running..."
    return !stdout.includes('INFO:');
  } catch {
    return false;
  }
}

export async function waitForProcess(processName, timeoutMs = 60000, pollMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isProcessRunning(processName)) return;
    await sleep(pollMs);
  }
  throw new Error(`Timeout waiting for process: ${processName} (${timeoutMs}ms)`);
}

export async function waitForAdb(timeoutMs = 60000, pollMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileP('adb', ['devices'], { windowsHide: true });
      // 找到带 "device" 结尾的非空行表示已就绪
      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.some(l => l.endsWith('device') && !l.startsWith('List'))) return;
    } catch { /* adb 未安装等直接吞掉等下一轮 */ }
    await sleep(pollMs);
  }
  throw new Error(`Timeout waiting for ADB device (${timeoutMs}ms)`);
}

export async function waitForWindowTitle(needle, timeoutMs = 60000, pollMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  const safe = needle.replace(/'/g, "''");
  const psCmd = `Get-Process | Where-Object { $_.MainWindowTitle -like '*${safe}*' } | Select-Object -First 1 -ExpandProperty MainWindowTitle`;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileP(
        'powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd],
        { windowsHide: true }
      );
      if (stdout.trim()) return;
    } catch { /* 进程枚举失败就等下轮 */ }
    await sleep(pollMs);
  }
  throw new Error(`Timeout waiting for window title like "${needle}" (${timeoutMs}ms)`);
}

// step.waitFor 分发
export async function applyWait(step) {
  const t = step.waitTimeoutMs || 60000;
  switch (step.waitFor) {
    case 'process':      return waitForProcess(step.waitTarget, t);
    case 'adb':          return waitForAdb(t);
    case 'window-title': return waitForWindowTitle(step.waitTarget, t);
    case 'sleep':        return sleep(t);
    case 'none':
    default:
      return Promise.resolve();
  }
}

// ========== 工具 ==========

function bindLogging(child, label) {
  child.stdout?.on('data', d => logInfo('launcher', `[${label}] ${d.toString().trimEnd()}`));
  child.stderr?.on('data', d => logError('launcher', `[${label} ERR] ${d.toString().trimEnd()}`));
  child.on('exit', (code, sig) =>
    logInfo('launcher', `[${label}] exit code=${code} sig=${sig}`)
  );
  // 关键：spawn 失败（如 ENOENT 路径不存在）会 emit 'error'，没人接 Node 进程会崩
  child.on('error', err =>
    logError('launcher', `[${label}] spawn error: ${err.message} (path=${label})`)
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== ALAS helper ==========

// alas.exe 路径的同级目录下的 config/ 目录
async function getAlasConfigDir(alasPath) {
  try {
    const p = path.dirname(alasPath);
    // alas.exe 在 AzurLaneAutoScript/ 下，config 也在同目录
    const cfgDir = path.join(p, 'config');
    await fs.access(cfgDir);
    return cfgDir;
  } catch { return null; }
}

// 读 config/*.json 找 user config (排除 template.*.json / deploy.*)
// 返回 [{name, hasTasks}] 列表，name 不含 .json 后缀
async function listAlasConfigs(configDir) {
  try {
    const files = await fs.readdir(configDir);
    const out = [];
    for (const f of files) {
      const lower = f.toLowerCase();
      if (!lower.endsWith('.json')) continue;
      if (lower.startsWith('template.') || lower.startsWith('deploy.template')) continue;
      const name = f.replace(/\.json$/i, '');
      // 简单检查文件含 Scheduler.Enable=true (有启用的 task)
      let hasEnabled = false;
      try {
        const raw = await fs.readFile(path.join(configDir, f), 'utf-8');
        const data = JSON.parse(raw);
        // 任意 task 有 Enable=true
        for (const k of Object.keys(data || {})) {
          const v = data[k];
          if (v && v.Scheduler && v.Scheduler.Enable === true) { hasEnabled = true; break; }
        }
      } catch {}
      out.push({ name, file: f, hasEnabled });
    }
    return out;
  } catch { return []; }
}

// 按 task.name 智能匹配 ALAS config name
//   优先级: 完全匹配 > 包含关键词 > 第一个启用的 config
function matchAlasConfig(configs, taskName) {
  if (!configs.length) return null;
  const lower = (taskName || '').toLowerCase();
  // 优先级 1: 完全匹配 (含或不含 task 后缀)
  let hit = configs.find(c => c.name.toLowerCase() === lower);
  if (hit) return hit.name;
  // 优先级 2: 关键词包含 (task.name 里的关键词在 config.name 里)
  const keywords = [];
  if (lower.includes('碧蓝') || lower.includes('azur')) keywords.push(['azur', 'alas']);
  if (lower.includes('明日方舟') || lower.includes('arknights')) keywords.push(['arknights', 'alas']);
  if (lower.includes('活动') || lower.includes('event')) keywords.push(['event', 'alas']);
  if (lower.includes('日常') || lower.includes('daily')) keywords.push(['daily', 'alas']);
  for (const [k1, k2] of keywords) {
    hit = configs.find(c =>
      c.name.toLowerCase().includes(k1) || c.name.toLowerCase().includes(k2));
    if (hit) return hit.name;
  }
  // 优先级 3: 兜底第一个启用的
  const enabled = configs.find(c => c.hasEnabled);
  return enabled ? enabled.name : configs[0].name;
}

// 综合 listAlasConfigs + matchAlasConfig
async function findAlasConfig(configDir, taskName) {
  const list = await listAlasConfigs(configDir);
  return matchAlasConfig(list, taskName);
}

// 等 TCP 端口 listen (ALAS webui ready 检测)
function waitForPort(port, timeoutMs = 60000, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = () => {
      const sock = net.connect(port, host);
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        try { sock.destroy(); } catch {}
        if (err) {
          if (Date.now() >= deadline) reject(new Error(`port ${port} not listening after ${timeoutMs}ms`));
          else setTimeout(tryOnce, 500);
        } else {
          resolve();
        }
      };
      sock.once('connect', () => done());
      sock.once('error', () => done(new Error('connect refused')));
      setTimeout(() => done(new Error('connect timeout')), 2000).unref();
    };
    tryOnce();
  });
}

// ========== 自动检测 ==========
const DETECT_RULES = [
  // MuMu 12 / 12 Pro / 老版 MuMu：覆盖常见安装位置 + 网易默认 D 盘路径
  { type: 'mumu12',           names: ['MuMuPlayer.exe', 'player.exe', 'MuMuPlayer-12.0.exe'],     dirs: [
      'C:\\Program Files\\Netease\\MuMuPlayer-12.0\\shell',
      'C:\\Program Files\\Netease\\MuMuPlayer\\shell',
      'C:\\MuMuPlayer-12.0\\shell',
      'C:\\MuMuPlayer\\shell',
      'D:\\Program Files\\Netease\\MuMuPlayer-12.0\\shell',
      'D:\\Program Files\\Netease\\MuMuPlayer\\shell',
      'D:\\MuMuPlayer-12.0\\shell',
      'D:\\MuMuPlayer\\shell',
    ] },
  // 雷电 / 雷电 9：默认路径 + 自定义盘符
  { type: 'ldplayer',         names: ['dnplayer.exe', 'ldplayer.exe', 'dnplayer9.exe'],         dirs: [
      'C:\\leidian\\LDPlayer',
      'C:\\LDPlayer',
      'C:\\LDPlayer9',
      'C:\\leidian\\LDPlayer9',
      'D:\\LDPlayer',
      'D:\\LDPlayer9',
      'D:\\leidian\\LDPlayer',
      'D:\\leidian\\LDPlayer9',
      'E:\\LDPlayer',
      'E:\\LDPlayer9',
    ] },
  // 蓝叠 5 / 蓝叠 X
  { type: 'bluestacks',       names: ['HD-Player.exe', 'BlueStacks_nxt.exe', 'BlueStacks.exe'],  dirs: [
      'C:\\Program Files\\BlueStacks_nxt',
      'C:\\Program Files\\BlueStacks',
      'D:\\Program Files\\BlueStacks_nxt',
      'D:\\Program Files\\BlueStacks',
    ] },
  // MAA / ALAS / BetterGi：路径分散，扫常见几个点 + 用户 MAA 目录
  { type: 'maa',              names: ['MAA.exe', 'MaaCore.exe'],                                  dirs: [
      'D:\\MAA',
      'D:\\MAA-win-x64',
      'D:\\MAA-win-arm64',
      'C:\\MAA',
      'C:\\Program Files\\MAA',
      'D:\\Program Files\\MAA',
    ] },
  { type: 'alas',             names: ['alas.exe'],                                                dirs: [
      'C:\\ALAS',
      'D:\\ALAS',
      'C:\\Program Files\\ALAS',
      'D:\\Program Files\\ALAS',
    ] },
  { type: 'bettergi',         names: ['BetterGI.exe'],                                            dirs: [
      'C:\\BetterGI',
      'D:\\BetterGI',
      'C:\\Program Files\\BetterGI',
      'D:\\Program Files\\BetterGI',
    ] },
  { type: 'popup',            names: [],                                                          dirs: [] }, // popup 是 spawn PowerShell，无路径
  { type: 'genshin-launcher', names: ['launcher.exe'],                                            dirs: ['C:\\Program Files\\Genshin Impact', 'D:\\Program Files\\Genshin Impact'] },
  { type: 'genshin-direct',   names: ['YuanShen.exe', 'GenshinImpact.exe'],                       dirs: ['C:\\Program Files\\Genshin Impact\\Genshin Impact Game', 'D:\\Program Files\\Genshin Impact\\Genshin Impact Game'] },
];

export async function detectInstalledPrograms() {
  const found = [];
  for (const rule of DETECT_RULES) {
    if (!rule.dirs.length) continue;
    for (const dir of rule.dirs) {
      for (const name of rule.names) {
        const p = path.join(dir, name);
        try {
          await fs.access(p);
          found.push({ type: rule.type, path: p, name: `${rule.type} @ ${p}` });
          break; // 找到一个就跳到下一个 type
        } catch { /* keep trying */ }
      }
    }
  }
  return found;
}
