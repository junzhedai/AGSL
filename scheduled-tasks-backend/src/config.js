// 数据持久化：programs.json（程序路径）+ tasks.json（任务列表）
import fs from 'node:fs/promises';
import path from 'node:path';

// 数据目录：用脚本所在位置而不是 cwd，这样无论从哪里启动都能定位到
// import.meta.dirname = 当前文件所在的目录（Node 20.11+）
// scheduled-tasks-backend/data/ 是项目内的数据目录
const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const PROGRAMS_FILE = path.join(DATA_DIR, 'programs.json');
const TASKS_FILE    = path.join(DATA_DIR, 'tasks.json');

await fs.mkdir(DATA_DIR, { recursive: true });

// 启动时清掉上一次 EPERM 留下的孤儿 .tmp
for (const f of [PROGRAMS_FILE + '.tmp', TASKS_FILE + '.tmp']) {
  try { await fs.unlink(f); } catch {}
}

async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJson(file, data) {
  // 原子写：先写临时文件再 rename，避免中途崩溃写坏
  // FAT32 / 可移动磁盘下 rename 经常被杀毒/索引器短暂锁住（EPERM / EBUSY），
  // 这里加重试 + copyFile 兜底，稳住 502
  const tmp = file + '.tmp';
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmp, json, 'utf-8');

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 1) 先试 rename（带退避重试，处理瞬时 EPERM/EBUSY）
  for (let i = 0; i < 6; i++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      const transient = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
      if (!transient || i === 5) {
        // rename 不再能救，转 fallback（见下）；如果 i === 5 直接抛
        if (i === 5) {
          try { await fs.unlink(tmp); } catch {}
          throw e;
        }
        break;
      }
      await sleep(80 * (i + 1));
    }
  }

  // 2) fallback：copyFile + unlink（FAT32 上比 rename 稳）
  for (let i = 0; i < 4; i++) {
    try {
      await fs.copyFile(tmp, file);
      try { await fs.unlink(tmp); } catch {}
      return;
    } catch (e) {
      const transient = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
      if (!transient || i === 3) {
        try { await fs.unlink(tmp); } catch {}
        throw e;
      }
      await sleep(120 * (i + 1));
    }
  }
}

export async function getPrograms() {
  const list = await readJson(PROGRAMS_FILE, [
    // 默认带一个 popup 程序，方便端到端测试"游戏1-测试"
    {
      id: 'popup-test',
      type: 'popup',
      name: '测试弹窗（端到端验证用）',
      path: 'powershell.exe',  // 实际用 PowerShell 弹 Form，仅占位
    },
  ]);
  // 自动迁移：displayName -> name（老数据兼容）
  let migrated = false;
  for (const p of list) {
    if (!p.name && p.displayName) {
      p.name = p.displayName;
      delete p.displayName;
      migrated = true;
    }
    if (!p.id) p.id = 'pg_' + Math.random().toString(36).slice(2, 10);
  }
  if (migrated) {
    try { await writeJson(PROGRAMS_FILE, list); } catch {}
  }
  return list;
}

export async function savePrograms(p) { await writeJson(PROGRAMS_FILE, p); }

export async function getTasks() {
  return readJson(TASKS_FILE, [
    // 示例任务：你之后在 UI 里改就行
    {
      id: 'demo-maa',
      name: '示例: MAA 每日',
      enabled: false,
      cron: '0 8 * * *',
      durationMs: 0,
      steps: [
        { type: 'ldplayer',    programId: 'ldplayer',    waitFor: 'process', waitTarget: 'ldplayer.exe', waitTimeoutMs: 60000 },
        { type: 'maa',         programId: 'maa',         waitFor: 'adb',     waitTimeoutMs: 60000 }
      ]
    },
    {
      id: 'demo-genshin',
      name: '示例: 原神 + BetterGi',
      enabled: false,
      cron: '0 20 * * *',
      durationMs: 0,
      steps: [
        { type: 'mumu12',           programId: 'mumu12',           waitFor: 'process',      waitTarget: 'MuMuPlayer.exe', waitTimeoutMs: 60000 },
        { type: 'genshin-launcher', programId: 'genshin-launcher', waitFor: 'process',      waitTarget: 'YuanShen.exe',   waitTimeoutMs: 120000 },
        { type: 'bettergi',         programId: 'bettergi',         waitFor: 'window-title', waitTarget: '原神',           waitTimeoutMs: 60000 }
      ]
    },
    {
      id: 'demo-test-popup',
      name: 'test: popup + auto-kill',
      enabled: false,
      // 整点后 1 分钟触发，便于立刻验证
      cron: '1 * * * *',
      // 30 秒后自动 kill（端到端测试用：弹出来后 30s 自动关掉）
      durationMs: 30000,
      steps: [
        {
          type: 'popup',
          programId: 'popup-test',
          waitFor: 'none',
          message: 'hello world',
          popupDurationMs: 30000,
        },
      ],
    },
  ]);
}

export async function saveTasks(t) { await writeJson(TASKS_FILE, t); }
