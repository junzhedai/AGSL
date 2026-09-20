// UI 数据 → 后端数据 转换 + 同步 + 自动检测
import { ref } from 'vue'
import { api } from './api.js'

// 当前后端拉到的程序配置（全局共享）
export const programs = ref([])

// 最近一次同步状态
export const syncState = ref({
  status: 'idle',   // 'idle' | 'ok' | 'fail'
  at: null,
  error: null,
  enabledCount: 0,
})
let programsLoaded = false

export async function ensureProgramsLoaded() {
  if (programsLoaded) return programs.value
  try {
    programs.value = await api.getPrograms()
    programsLoaded = true
  } catch (e) {
    console.warn('[sync] 加载 programs 失败', e)
    return []
  }
  // 第一次且后端没配置过程序时，自动扫一遍常见安装位置
  if (programs.value.length === 0) {
    await runAutoDetect()
  }
  return programs.value
}

export async function runAutoDetect() {
  try {
    const found = await api.detectPrograms()
    if (!found.length) return []
    // 把已存在的 program 索引出来（按 type），避免覆盖占位项
    const existingByType = new Map()
    for (const p of programs.value) {
      // 同 type 的占位（path 为空）只保留一个，等会儿如果扫到了就替换它的 path
      if (!existingByType.has(p.type)) existingByType.set(p.type, p)
    }
    const merged = [...programs.value]
    for (const p of found) {
      const slot = existingByType.get(p.type)
      if (slot && (!slot.path || !String(slot.path).trim())) {
        // 找到占位：原地补 path + name，不新增条目
        slot.path = p.path
        slot.name = (slot.name && !slot.name.includes('占位'))
          ? slot.name
          : (p.name || (p.type + ' @ ' + p.path))
      } else if (!slot) {
        // 没有占位：新增条目
        const baseName = (p.path || '').split(/[\\/]/).pop()?.replace(/\.(exe|bat|cmd)$/i, '') || p.type
        merged.push({
          id: 'pd_' + p.type + '_' + Math.random().toString(36).slice(2, 8),
          type: p.type,
          path: p.path,
          name: p.name || baseName,
        })
      }
      // 已有非空 path 的同 type 条目：跳过，避免重复
    }
    programs.value = merged
    await api.putPrograms(programs.value)
    programsLoaded = true
    return programs.value
  } catch (e) {
    console.warn('[sync] 自动检测失败', e)
    return []
  }
}

// games[].script_id → 后端 step.type
const SCRIPT_TYPE_BY_TAG = {
  'alas':     'alas',
  'MAA':      'maa',
  'MAA_END':  'maa',
  'MAA_NTE':  'maa',
  'BetterGI': 'bettergi',
  'test':     'popup',     // 端到端测试用：弹个 PowerShell 弹窗
}
const EMU_TYPES       = ['mock', 'mumu12', 'ldplayer', 'bluestacks']
const LAUNCHER_GAMES  = ['genshin-launcher', 'genshin-direct']

function pickProgram(types) {
  return programs.value.find(p => types.includes(p.type))
}

// 按 task.name 找最匹配的 mock program + 默认 serial + 弹窗显示名
// 例: "碧蓝航线" -> mock-azur-lane + serial='azurline_test' + displayName='碧蓝航线'
//     "明日方舟" -> mock-arknights + serial='arknights_test' + displayName='明日方舟'
function pickMockByName(taskName) {
  if (!taskName) return null
  const lower = String(taskName).toLowerCase()
  if (lower.includes('azur') || lower.includes('碧蓝')) {
    return {
      program: programs.value.find(p => p.id === 'mock-azur-lane'),
      serial: 'azurline_test',
      title: 'Azur Lane',
      displayName: '碧蓝航线',
    }
  }
  if (lower.includes('arknights') || lower.includes('明日方舟')) {
    return {
      program: programs.value.find(p => p.id === 'mock-arknights'),
      serial: 'arknights_test',
      title: 'Arknights',
      displayName: '明日方舟',
    }
  }
  // 兜底: 任意 type=mock 的 program
  return { program: programs.value.find(p => p.type === 'mock'), serial: undefined }
}

function minutesToCron(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${m} ${h} * * *`
}

// 单个 UI 任务 → 后端 task
function uiTaskToBackend(s, games) {
  let meta = games.find(g => g.name === s.name)
  if (!meta) {
    // fallback 优先选 popup 类型的游戏，games[0] 兜底
    meta = games.find(g => g.script_id === 'test')
        || games.find(g => g.script_id === 'popup')
        || games[0]
  }
  let scriptTag = meta?.script_id
  let scriptType = SCRIPT_TYPE_BY_TAG[scriptTag]

  const steps = []
  // 给 launcher 用的 task.name (mock serial 匹配 + ALAS config 匹配)
  const taskName = s.name || ''

  // 1) 模拟器：use_emulator=true 时插入（popup 测试不启用）
  if (s.use_emulator && scriptType !== 'popup') {
    // 优先按 task.name 选 mock (mock-azur-lane / mock-arknights) + 默认 serial
    const mockPick = pickMockByName(s.name)
    let emu = mockPick?.program || pickProgram(EMU_TYPES)
    let defaultSerial = mockPick?.serial
    if (emu) {
      steps.push({
        type: emu.type,
        programId: emu.id,
        waitFor: emu.type === 'mock' ? 'none' : 'adb',  // mock launcher 内部等 ready
        waitTimeoutMs: emu.type === 'mock' ? (s.mockStartupMs || 15000) : 60000,
        // 用户 UI 没填则用 task.name 派生的默认 mock serial
        adbSerial: s.adb || defaultSerial || undefined,
        ldIndex: emu.type === 'ldplayer' ? 0 : undefined,
        // mock launcher 透传参数
        startupMs: emu.type === 'mock' ? (s.mockStartupMs || 5000) : undefined,
        // mock 弹窗显示名 (按 task.name 派生)
        title: emu.type === 'mock' ? (mockPick?.title || s.name) : undefined,
        displayName: emu.type === 'mock' ? (mockPick?.displayName || s.name) : undefined,
        // 不同 mock 错开位置避免重叠
        windowX: emu.type === 'mock' ? (mockPick?.title === 'Azur Lane' ? 120 : 620) : undefined,
        windowY: emu.type === 'mock' ? 120 : undefined,
      })
    }
  }

  // 2) 原神游戏本体（仅 BetterGI）
  if (scriptTag === 'BetterGI') {
    const game = pickProgram(LAUNCHER_GAMES)
    if (game) {
      steps.push({
        type: game.type,
        programId: game.id,
        waitFor: 'process',
        waitTarget: 'YuanShen.exe',
        waitTimeoutMs: 180000,
      })
    }
  }

  // 3) 脚本本体：找 program，找不到/类型未配置 → 降级到 popup
  const NEED_EXTERNAL = ['alas', 'maa', 'bettergi']
  let downgradeToPopup = false
  if (scriptType === 'popup') {
    // 直接走 popup
  } else if (scriptType && NEED_EXTERNAL.includes(scriptType)) {
    const sp = programs.value.find(p => p.type === scriptType)
    if (sp) {
      steps.push({
        type: scriptType,
        programId: sp.id,
        waitFor: 'none',
        // 透传给 launcher (ALAS 用 alasConfig 自动匹配 config 名)
        alasConfig: s.alasConfig || undefined,
        taskName,
      })
    } else {
      console.warn('[sync] 未配置', scriptType, '程序，降级到 popup 兜底')
      downgradeToPopup = true
    }
  }

  // 强制 popup step（如果有降级，或者原本就是 popup）
  if (scriptType === 'popup' || downgradeToPopup) {
    // popup 默认 5 分钟（300000ms），受 UI 的 duration 字段控制
    const sec = Math.max(60, Math.round(((s.duration || 0) * 60) || 5 * 60))
    steps.push({
      type: 'popup',
      programId: 'popup-test',
      waitFor: 'none',
      message: 'hello world',
      popupDurationMs: sec * 1000,
    })
  }

  // 最后兜底：万一 steps 仍然是空（比如 scriptType 未知），硬塞一个 popup 进去
  // 这样定时任务**永远**不会因前端 sync bug 而"空跑"
  if (steps.length === 0) {
    console.warn('[sync] 兜底：任务', s.name || s._bid, '无 step，强制塞 popup')
    const sec = Math.max(60, Math.round(((s.duration || 0) * 60) || 5 * 60))
    steps.push({
      type: 'popup',
      programId: 'popup-test',
      waitFor: 'none',
      message: 'hello world',
      popupDurationMs: sec * 1000,
    })
  }

  // durationMs：仅在 UI 勾了"时间到自动关闭"才非 0
  const durationMs = s.autoKill && typeof s.duration === 'number'
    ? s.duration * 60 * 1000
    : 0

  return {
    id: s._bid,
    name: s.name || '(未命名)',
    enabled: !!s.active,
    cron: typeof s.launch_time === 'number' ? minutesToCron(s.launch_time) : null,
    durationMs,
    steps,
  }
}

// 把整个激活配置的 scripts 推给后端
export async function syncAll(configs, games, activeConfigId) {
  try {
    await ensureProgramsLoaded()
    const cfg = configs.find(c => c.id === activeConfigId)
    if (!cfg) {
      syncState.value = { status: 'fail', at: Date.now(), error: '无激活配置', enabledCount: 0 }
      return
    }
    const tasks = (cfg.scripts || []).map(s => uiTaskToBackend(s, games))
    const updated = await api.putTasks(tasks)
    const enabledCount = updated.filter(t => t.enabled && t.cron).length
    syncState.value = {
      status: 'ok',
      at: Date.now(),
      error: null,
      enabledCount,
    }
  } catch (e) {
    syncState.value = {
      status: 'fail',
      at: Date.now(),
      error: String(e.message || e),
      enabledCount: 0,
    }
  }
}

export async function runOne(taskBid) {
  try {
    await api.runTask(taskBid)
  } catch (e) {
    throw e
  }
}

export function formatTimeAgo(ts) {
  if (!ts) return ''
  const delta = Date.now() - ts
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return Math.floor(delta / 60_000) + ' 分钟前'
  if (delta < 86_400_000) return Math.floor(delta / 3_600_000) + ' 小时前'
  return new Date(ts).toLocaleString()
}
