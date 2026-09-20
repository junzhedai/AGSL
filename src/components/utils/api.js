// 后端 API 客户端
// 开发环境通过 vite.config.ts 的 /api proxy 转发到 127.0.0.1:5180
const BASE = '/api'

async function req(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let res
  try {
    res = await fetch(BASE + path, opts)
  } catch (e) {
    throw new Error('后端连接失败（确认 scheduled-tasks-backend 启动了）：' + (e.message || e))
  }
  if (!res.ok) {
    let msg = `${method} ${path} -> ${res.status}`
    try {
      const j = await res.json()
      if (j && j.error) msg += ' ' + j.error
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export const api = {
  // 程序配置（路径）
  getPrograms:    ()    => req('GET',  '/programs'),
  putPrograms:    (arr) => req('PUT',  '/programs', arr),
  detectPrograms: ()    => req('POST', '/programs/detect'),
  // 文件系统浏览（前端路径选择器用）
  browseFs:       (p)   => req('GET',  `/fs/browse?path=${encodeURIComponent(p || '')}`),
  checkPath:      (p)   => req('GET',  `/fs/path-exists?path=${encodeURIComponent(p || '')}`),
  // ALAS user config 列表（前端 ALAS 配置名下拉用）
  alasConfigs:    (p)   => req('GET',  `/alas/configs?alasPath=${encodeURIComponent(p || '')}`),
  // 任务
  getTasks:       ()    => req('GET',  '/tasks'),
  putTasks:       (arr) => req('PUT',  '/tasks', arr),
  toggleTask:     (id)  => req('POST', `/tasks/${encodeURIComponent(id)}/toggle`),
  runTask:        (id)  => req('POST', `/tasks/${encodeURIComponent(id)}/run`),
  // 状态
  getStatus:      ()    => req('GET',  '/status'),
  killAll:        ()    => req('POST', '/kill-all'),
}
