// HTTP API + 启动入口
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  getPrograms, savePrograms,
  getTasks, saveTasks,
} from './src/config.js';
import {
  rescheduleAll, runTask, killAll, killProgram,
  getRunning, getEvents,
} from './src/scheduler.js';
import { detectInstalledPrograms } from './src/launcher.js';
import { logInfo, logWarn, logError, getLogs, clearLogs } from './src/logger.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let programs = [];
let tasks = [];

// 启动时清空 server.log（用脚本所在位置，不用 cwd）
try {
  fs.writeFileSync(path.join(import.meta.dirname, 'server.log'), '');
} catch {}

async function loadAll() {
  programs = await getPrograms();
  tasks    = await getTasks();
  rescheduleAll(tasks, programs);
  logInfo('system', `loaded ${programs.length} programs, ${tasks.length} tasks`);
}
await loadAll();

logInfo('system', 'backend ready');

// ---- API ----

// 程序配置（路径）
app.get('/api/programs',  (_req, res) => res.json(programs));
app.put('/api/programs',  async (req, res) => {
  programs = req.body;
  await savePrograms(programs);
  rescheduleAll(tasks, programs);
  res.json(programs);
});
app.post('/api/programs/detect', async (_req, res) => {
  const found = await detectInstalledPrograms();
  res.json(found);
});

// 任务列表
app.get('/api/tasks',   (_req, res) => res.json(tasks));
app.put('/api/tasks',   async (req, res) => {
  tasks = req.body;
  await saveTasks(tasks);
  rescheduleAll(tasks, programs);
  res.json(tasks);
});

// 立即触发（不阻塞响应）
app.post('/api/tasks/:id/run', (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'not found' });
  logInfo('api', `run task ${task.id} (${task.name})`);
  runTask(task, programs)
    .then(r => logInfo('api', `task ${task.id} result: ${JSON.stringify(r)}`))
    .catch(e => logError('api', `task ${task.id} error: ${e.message || e}`));
  res.json({ ok: true, queued: true });
});

// 启用 / 停用（重新调度）
app.post('/api/tasks/:id/toggle', async (req, res) => {
  const t = tasks.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  t.enabled = !t.enabled;
  await saveTasks(tasks);
  rescheduleAll(tasks, programs);
  logInfo('api', `toggle ${t.id} -> enabled=${t.enabled}`);
  res.json(t);
});

// 状态
app.get('/api/status', (_req, res) => {
  res.json({
    running: getRunning(),
    events:  getEvents().slice(0, 50),
    scheduledCount: tasks.filter(t => t.enabled && t.cron).length,
  });
});

// 进程控制
app.post('/api/kill-all',         (_req, res) => { killAll();         logInfo('api', 'kill all'); res.json({ ok: true }); });
app.post('/api/kill-program/:id', (req, res)  => { killProgram(req.params.id); logInfo('api', `kill program ${req.params.id}`); res.json({ ok: true }); });

// 日志（前端日志面板用）
app.get('/api/logs', (req, res) => {
  const tail = Math.max(1, Math.min(1000, Number(req.query.tail) || 200));
  res.json(getLogs(tail));
});
app.delete('/api/logs', (_req, res) => {
  clearLogs();
  res.json({ ok: true });
});

// ---- 文件系统浏览 (前端路径选择器用) ----

// 路径白名单：只允许浏览这些根下面的路径，防止前端任意列 C:\Windows
function isPathAllowed(p) {
  const norm = path.resolve(p).toLowerCase();
  const roots = [];
  // 1) 用户家目录
  const home = process.env.USERPROFILE || '';
  if (home) roots.push(home.toLowerCase());
  // 2) Program Files / Program Files (x86) (所有盘)
  for (let c = 65; c <= 90; c++) {
    const d = String.fromCharCode(c);
    roots.push(`${d.toLowerCase()}:\\program files`);
    roots.push(`${d.toLowerCase()}:\\program files (x86)`);
  }
  // 3) 盘根
  for (let c = 65; c <= 90; c++) {
    roots.push(`${String.fromCharCode(c).toLowerCase()}:\\`);
  }
  // 4) 用户自建根目录 (与 searchProgramFallback 同步)
  roots.push('c:\\daijunzhe');
  // 5) 环境变量 AGSL_CUSTOM_TOP_DIRS 自定义顶层
  const customTopsEnv = process.env.AGSL_CUSTOM_TOP_DIRS || '';
  if (customTopsEnv) {
    for (const r of customTopsEnv.split(/[;|]/)) {
      const t = r.trim();
      if (t) roots.push(t.toLowerCase());
    }
  }
  return roots.some(r => norm === r || norm.startsWith(r + '\\'));
}

app.get('/api/fs/browse', async (req, res) => {
  try {
    const reqPath = String(req.query.path || '');
    if (!reqPath) return res.status(400).json({ error: 'path required' });
    const abs = path.resolve(reqPath);
    if (!isPathAllowed(abs)) {
      return res.status(403).json({ error: `path not allowed: ${abs}` });
    }
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const items = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
    }));
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    res.json({ path: abs, parent: path.dirname(abs), entries: items });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'path not found' });
    if (e.code === 'EACCES' || e.code === 'EPERM') return res.status(403).json({ error: 'access denied' });
    res.status(500).json({ error: e.message || String(e) });
  }
});

app.get('/api/fs/path-exists', async (req, res) => {
  try {
    const reqPath = String(req.query.path || '');
    if (!reqPath) return res.status(400).json({ error: 'path required' });
    const abs = path.resolve(reqPath);
    if (!isPathAllowed(abs)) {
      return res.status(403).json({ error: `path not allowed: ${abs}` });
    }
    const stat = await fsp.stat(abs);
    res.json({ exists: true, isFile: stat.isFile(), isDir: stat.isDirectory(), size: stat.size });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ exists: false });
    if (e.code === 'EACCES' || e.code === 'EPERM') return res.status(403).json({ error: 'access denied' });
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ALAS config 扫描: 返回 ALAS 程序同目录 config/ 下的 user config 列表
// 用法: 前端 ALAS 配置名下拉选项 / launcher 自动匹配
app.get('/api/alas/configs', async (req, res) => {
  try {
    const alasPath = String(req.query.alasPath || '');
    if (!alasPath) return res.status(400).json({ error: 'alasPath required' });
    const p = path.resolve(alasPath);
    const cfgDir = path.join(path.dirname(p), 'config');
    await fsp.access(cfgDir);  // 不存在抛错
    const files = await fsp.readdir(cfgDir);
    const out = [];
    for (const f of files) {
      const lower = f.toLowerCase();
      if (!lower.endsWith('.json')) continue;
      if (lower.startsWith('template.') || lower.startsWith('deploy.template')) continue;
      const name = f.replace(/\.json$/i, '');
      let hasEnabled = false;
      try {
        const raw = await fsp.readFile(path.join(cfgDir, f), 'utf-8');
        const data = JSON.parse(raw);
        for (const k of Object.keys(data || {})) {
          const v = data[k];
          if (v && v.Scheduler && v.Scheduler.Enable === true) { hasEnabled = true; break; }
        }
      } catch {}
      out.push({ name, file: f, hasEnabled });
    }
    res.json({ configDir: cfgDir, configs: out });
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).json({ error: 'ALAS config 目录不存在' });
    res.status(500).json({ error: e.message || String(e) });
  }
});

const port = Number(process.env.PORT) || 5180;
app.listen(port, '127.0.0.1', () => {
  logInfo('system', `listening on http://127.0.0.1:${port}`);
});
