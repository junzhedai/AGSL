// 集中日志：内存 ringbuffer + 文件 append
import fs from 'node:fs';
import path from 'node:path';

// 日志文件：用脚本所在位置而不是 cwd，保证不管从哪启动都写到项目内
const LOG_FILE = path.join(import.meta.dirname, '..', 'server.log');
const MAX_LINES = 1000;

const buffer = [];

export function appendLog(level, type, msg) {
  const safeMsg = typeof msg === 'string'
    ? msg
    : (() => { try { return JSON.stringify(msg); } catch { return String(msg); } })();
  const entry = {
    ts: Date.now(),
    level,
    type: String(type || 'system'),
    msg: safeMsg,
  };
  buffer.push(entry);
  if (buffer.length > MAX_LINES) buffer.shift();

  // 写到文件（一行一条）
  try {
    const isoStr = new Date(entry.ts).toISOString();
    const line = `[${isoStr}] [${level}] [${entry.type}] ${safeMsg}\n`;
    fs.appendFileSync(LOG_FILE, line, 'utf-8');
  } catch { /* 写失败不抛，避免把后台搞崩 */ }
}

export function logInfo(type, msg)  { appendLog('INFO', type, msg); }
export function logWarn(type, msg)  { appendLog('WARN', type, msg); }
export function logError(type, msg) { appendLog('ERROR', type, msg); }

export function getLogs(tail = 200) {
  return buffer.slice(-Math.max(1, Math.min(MAX_LINES, tail)));
}

export function clearLogs() {
  buffer.length = 0;
  try {
    fs.writeFileSync(LOG_FILE, '', 'utf-8');
  } catch {}
  appendLog('INFO', 'system', 'log cleared');
}
