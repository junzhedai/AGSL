// 任务调度：每个任务是一串有顺序的步骤，跑完前一步再去下一步
import schedule from 'node-schedule';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pickLauncher, applyWait } from './launcher.js';
import { savePrograms } from './config.js';
import { logInfo, logWarn, logError } from './logger.js';

// taskId:programId -> child process
const running = new Map();

// taskId -> { job, task, programs }
const jobs = new Map();

// 最近事件环形日志
const events = [];
function logEvent(e) {
  events.push({ ts: Date.now(), ...e });
  if (events.length > 200) events.shift();
  // 也写到集中日志（事件 + 系统消息合并）
  const msg = `[${e.type}] task=${e.taskId || '-'} ${e.msg}`;
  if (e.type === 'task-fail' || e.type === 'task-kill') {
    logInfo('event', msg);
  } else {
    logInfo('event', msg);
  }
}

export function getRunning() {
  return Array.from(running.entries()).map(([key, c]) => ({ key, pid: c.pid }));
}

export function getEvents() {
  return [...events].reverse();
}

export async function runTask(task, programs) {
  logInfo('scheduler', `run ${task.id} - ${task.name}`);
  logEvent({ type: 'task-start', taskId: task.id, msg: task.name });
  try {
    for (const step of task.steps || []) {
      const program = programs.find(p => p.id === step.programId);
      if (!program) {
        throw new Error(`步骤引用了不存在的 programId=${step.programId}`);
      }
      // 占位 program：path 为空时跳过该步骤而不是崩 spawn
      const display = program.name || program.displayName || program.id || 'unknown';
      if (!program.path || !String(program.path).trim()) {
        const msg = `${display} 路径为空（占位未配置），跳过 step ${step.type}`;
        logWarn('scheduler', `  ${msg}`);
        logEvent({ type: 'step-skip', taskId: task.id, msg });
        continue;
      }
      logInfo('scheduler', `  step ${step.type} -> ${program.path}`);
      logEvent({ type: 'step-start', taskId: task.id, msg: `${step.type}: ${display}` });

      const launcher = pickLauncher(step.type);
      // 自动搜索 fallback：path 不存在时尝试扫盘找匹配 type 的程序
      await resolveProgramPath(program, programs, { persist: true });
      const key = `${task.id}:${program.id}`;

      // retry 机制：spawn 失败 / ready 超时 / spawn ENOENT 都会自动重试
      const MAX_ATTEMPTS = 3;
      const RETRY_DELAYS = [2000, 4000, 6000]; // 递增
      let success = false;
      let lastErr = null;
      let child = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        child = null;
        try {
          logInfo('scheduler', `  step ${step.type} attempt ${attempt}/${MAX_ATTEMPTS}`);
          const result = await launcher(program, step);
          child = result.process;
          const readyPromise = result.readyPromise;
          running.set(key, child);
          child.on('exit', () => running.delete(key));

          // spawn 同步失败检查（ENOENT 等）
          await new Promise(r => setImmediate(r));
          if (!child.pid) {
            throw new Error(`spawn failed: ${program.path} (路径不存在 / 无权限 / 不是可执行文件)`);
          }

          // 等就绪（readyPromise / applyWait 谁先完成都行）
          await Promise.race([readyPromise, applyWait(step)]);
          logEvent({ type: 'step-ready', taskId: task.id, msg: `${step.type} 启动完成 (第 ${attempt} 次)` });
          success = true;
          break;
        } catch (err) {
          lastErr = err;
          logWarn('scheduler', `  step ${step.type} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
          if (child) {
            try { child.kill(); } catch {}
            running.delete(key);
          }
          if (attempt < MAX_ATTEMPTS) {
            const delay = RETRY_DELAYS[attempt - 1];
            logEvent({ type: 'step-retry', taskId: task.id, msg: `${step.type} 重试 (${attempt + 1}/${MAX_ATTEMPTS}，等待 ${delay}ms): ${err.message}` });
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      if (!success) {
        throw lastErr || new Error(`${step.type} 启动失败 (重试 ${MAX_ATTEMPTS} 次仍失败)`);
      }
    }

    // durationMs > 0 时，到点杀该 task 名下所有 child
    if (task.durationMs && task.durationMs > 0) {
      const durMs = Number(task.durationMs);
      const t = setTimeout(() => {
        let killed = 0;
        running.forEach((c, key) => {
          if (key.startsWith(task.id + ':')) {
            try { c.kill(); killed++; } catch {}
            running.delete(key);
          }
        });
        logEvent({
          type: 'task-kill',
          taskId: task.id,
          msg: `duration ${Math.round(durMs / 1000)}s 时间到，kill ${killed} 个子进程`,
        });
      }, durMs);
      // 不让 timer 阻止进程退出
      if (typeof t.unref === 'function') t.unref();
      logEvent({ type: 'task-watchdog', taskId: task.id, msg: `将在 ${Math.round(durMs / 1000)}s 后自动结束` });
    }

    logEvent({ type: 'task-ok', taskId: task.id, msg: task.name });
    return { ok: true };
  } catch (err) {
    logEvent({ type: 'task-fail', taskId: task.id, msg: String(err.message || err) });
    logError('scheduler', `fail ${task.id}: ${err.message || err}`);
    return { ok: false, error: String(err.message || err) };
  }
}

export function killAll() {
  for (const [, c] of running) { try { c.kill(); } catch {} }
  running.clear();
}

export function killProgram(programId) {
  for (const [key, c] of running) {
    if (key.endsWith(`:${programId}`)) {
      try { c.kill(); } catch {}
      running.delete(key);
    }
  }
}

// 重新注册所有 cron（增删改任务后调用）
export function rescheduleAll(tasks, programs) {
  for (const [, entry] of jobs) entry.job.cancel();
  jobs.clear();
  for (const task of tasks) {
    if (!task.enabled || !task.cron) continue;
    try {
      const job = schedule.scheduleJob(task.cron, () => {
        // 定时回调：异步执行，不阻塞调度
        runTask(task, programs).catch(console.error);
      });
      jobs.set(task.id, { job, task, programs });
    } catch (e) {
      console.error(`[scheduler] bad cron for ${task.id}: ${e.message}`);
    }
  }
}

// ========== 程序路径 fallback 搜索 ==========
// 当配置的 program.path 不存在时（如 U 口未插、版本号子目录变化），
// 自动扫所有可用盘符的常见位置找匹配 type 的程序。
// 找到 → 替换 program.path + 持久化 + logInfo 提示。
// 找不到 → 走 spawn 失败逻辑（红色错误日志）。

const TYPE_FILENAMES = {
  mumu12:           ['MuMuPlayer.exe', 'player.exe', 'MuMuPlayer-12.0.exe'],
  ldplayer:         ['dnplayer.exe', 'ldplayer.exe', 'dnplayer9.exe'],
  bluestacks:       ['HD-Player.exe', 'BlueStacks_nxt.exe', 'BlueStacks.exe'],
  maa:              ['MAA.exe', 'MaaCore.exe'],
  alas:             ['Alas.exe', 'alas.exe'],
  bettergi:         ['BetterGI.exe'],
  'genshin-launcher': ['launcher.exe'],
  'genshin-direct': ['YuanShen.exe', 'GenshinImpact.exe'],
};

// 各 type 的目录别名匹配（处理中文命名 / 拼音 / 厂商名）
const TYPE_DIR_ALIASES = {
  mumu12:           ['mumu', 'netease', '网易'],
  ldplayer:         ['ldplayer', 'leidian', 'dnplayer', '雷电'],
  bluestacks:       ['bluestacks', '蓝叠'],
  maa:              ['maa'],
  alas:             ['alas', 'azur', 'azurlane'],
  bettergi:         ['bettergi'],
  'genshin-launcher': ['genshin', 'yuanshen', '原神'],
  'genshin-direct':   ['genshin', 'yuanshen', '原神'],
};

async function getAvailableDrives() {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    try {
      await fs.access(`${letter}:\\`);
      drives.push(`${letter}:`);
    } catch {}
  }
  return drives;
}

async function searchProgramFallback(type) {
  const filenames = TYPE_FILENAMES[type];
  if (!filenames || !filenames.length) return null;
  const filenamesLower = filenames.map(f => f.toLowerCase());
  const aliases = TYPE_DIR_ALIASES[type] || [];

  const drives = await getAvailableDrives();
  if (!drives.length) return null;

  // 跳过的系统目录（避免扫 Windows/Winsxs 等海量子目录）
  const SKIP_DIRS = /^(windows|winsxs|programdata|\$recycle\.bin|system volume information|recovery|perflogs|appdata|microsoft|adobe|common files|node_modules|\.git|\.cache|\.vscode|\.android|\.mavis|\.minimax)$/i;

  // 收集所有要搜的"顶层目录"
  const tops = [];
  for (const d of drives) {
    tops.push(`${d}\\`);
    tops.push(path.join(`${d}\\`, 'Program Files'));
    tops.push(path.join(`${d}\\`, 'Program Files (x86)'));
  }
  // 用户家目录 + 常见位置（ALAS/MAA/BetterGi 经常放这）
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) {
    tops.push(home);
    tops.push(path.join(home, 'AppData', 'Local'));
    tops.push(path.join(home, 'AppData', 'Roaming'));
    tops.push(path.join(home, 'AppData', 'Local', 'Programs'));
  }
  // 用户自建顶层目录 (例如 C:\DAIJUNZHE 放各种开发工具)
  tops.push('C:\\DAIJUNZHE');
  // 通过环境变量 AGSL_CUSTOM_TOP_DIRS 追加更多顶层目录 (用 ; 或 | 分隔)
  const customTopsEnv = process.env.AGSL_CUSTOM_TOP_DIRS || '';
  if (customTopsEnv) {
    tops.push(...customTopsEnv.split(/[;|]/).map(s => s.trim()).filter(Boolean));
  }

  // 用并行的 fs.readdir (Promise.all) 加速
  async function readdirSafe(dir) {
    try { return { dir, entries: await fs.readdir(dir, { withFileTypes: true }) }; }
    catch { return { dir, entries: [] }; }
  }
  function matchesType(name) {
    const n = name.toLowerCase();
    if (n.includes(type.toLowerCase())) return true;
    return aliases.some(a => n.includes(a.toLowerCase()));
  }
  function findFileInEntries(dir, entries) {
    for (const e of entries) {
      if (e.isFile() && filenamesLower.includes(e.name.toLowerCase())) {
        return path.join(dir, e.name);
      }
    }
    return null;
  }

  // 阶段 1: 顶层目录直接有匹配文件
  // 例: C:\Tools\MAA.exe
  const allTops = await Promise.all(tops.map(readdirSafe));
  for (const { dir, entries } of allTops) {
    const hit = findFileInEntries(dir, entries);
    if (hit) return hit;
  }

  // 阶段 2: 顶层目录 → 深度 1 非系统子目录 → 深度 2 文件
  // 同时检查深度 2 的子目录 (深度 3) 是否含 type 关键字, 命中则触发阶段 3 深探
  const subsToScan = [];
  for (const { dir, entries } of allTops) {
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.test(e.name)) continue;
      subsToScan.push({ fullPath: path.join(dir, e.name) });
    }
  }
  const subResults = await Promise.all(subsToScan.map(async (s) => {
    const entries = await fs.readdir(s.fullPath, { withFileTypes: true }).catch(() => []);
    return { ...s, entries };
  }));

  // 收集深度 2 中"含 type 关键字的子目录" (深度 3 命中) - 准备阶段 3 深探
  const deepDirsToScan = [];
  for (const { fullPath, entries } of subResults) {
    // 先检查深度 2 文件命中
    const hit = findFileInEntries(fullPath, entries);
    if (hit) return hit;
    // 再记录命中关键字的深度 3 子目录
    for (const e of entries) {
      if (e.isDirectory() && matchesType(e.name)) {
        deepDirsToScan.push(path.join(fullPath, e.name));
      }
    }
  }

  // 没找到任何关键字命中的深度 3 目录 → 结束
  if (deepDirsToScan.length === 0) return null;

  // 阶段 3: 深度 3 (命中关键字) → 深度 4 文件
  // 例: C:\DAIJUNZHE\AlasApp_0.4.10_fullcn\AzurLaneAutoScript\Alas.exe
  const deepResults = await Promise.all(deepDirsToScan.map(readdirSafe));
  for (const { dir, entries } of deepResults) {
    const hit = findFileInEntries(dir, entries);
    if (hit) return hit;
  }
  return null;
}

/**
 * 检查 program.path 是否存在。不存在则自动搜索 fallback。
 * 找到：替换 program.path + (可选) 持久化 + 返回 true。
 * 找不到：返回 false（继续往下走，spawn 失败会走红色错误）。
 *
 * @param {object}  program    单个 program 对象
 * @param {object[]} programs  programs 数组 (仅在 persist=true 时写入文件)
 * @param {object}  [opts]
 * @param {boolean} [opts.persist=false]  是否把新路径持久化到 programs.json
 *                                        默认 false — 调用者需显式开启避免误写文件
 */
export async function resolveProgramPath(program, programs, opts = {}) {
  const persist = opts.persist === true;
  if (!program.path || !String(program.path).trim()) return false;
  try {
    await fs.access(program.path);
    return true; // 文件存在
  } catch {}

  // 文件不存在 → 自动搜索
  logWarn('scheduler', `program.path 不存在: ${program.path}，尝试自动搜索 ${program.type}...`);
  const found = await searchProgramFallback(program.type);
  if (found) {
    const display = program.name || program.displayName || program.id || 'unknown';
    logInfo('scheduler', `自动搜索找到 ${display}: ${found}`);
    program.path = found;
    if (persist) {
      try {
        await savePrograms(programs);
        logInfo('scheduler', `已更新 programs.json 持久化新路径`);
      } catch (e) {
        logWarn('scheduler', `持久化新路径失败 (下次启动仍会重搜): ${e.message}`);
      }
    } else {
      logInfo('scheduler', `(未持久化 — 仅本次运行生效)`);
    }
    return true;
  }
  logWarn('scheduler', `自动搜索未找到 ${program.type}，将尝试 spawn 原始路径（会失败）`);
  return false;
}
