<template>
  <div class="app">
    <!-- ============ 顶部 header ============ -->
    <header class="topbar">
      <div class="brand">
        <div class="brand-logo">AGSL</div>
        <div class="brand-tagline">automatic game scripts launcher</div>
      </div>
      <div class="topbar-right">
        <span class="topbar-info">
          <span v-if="saveStatus === 'saving'" class="status saving">保存中…</span>
          <span v-else-if="saveStatus === 'saved'" class="status saved">已保存</span>
          <span v-else-if="saveStatus === 'error'" class="status error">保存失败</span>
        </span>
        <span
          class="sync-indicator"
          :class="{ fail: syncState.status === 'fail', ok: syncState.status === 'ok' }"
          :title="syncState.status === 'fail' ? syncState.error : ''"
        >
          <span v-if="syncState.status === 'ok'">
            ⟳ 已同步
            <small v-if="syncState.enabledCount > 0">({{ syncState.enabledCount }})</small>
          </span>
          <span v-else-if="syncState.status === 'fail'">⚠ {{ syncState.error }}</span>
        </span>
        <button class="topbar-btn" @click="openGames = true">游戏库</button>
        <button class="topbar-btn" @click="openPrograms = true">程序管理</button>
      </div>
    </header>

    <!-- ============ 主体：配置栏 + 任务栏 + 日志栏 ============ -->
    <main class="main">
      <!-- 左侧：配置栏 -->
      <aside class="config-sidebar">
        <div class="config-sidebar-head">配置</div>
        <div class="config-list">
          <div
            v-for="cfg in configs"
            :key="cfg.id"
            class="config-item"
            :class="{ active: cfg.id === activeConfigId }"
            @click="switchConfig(cfg.id)"
          >
            <span class="name">{{ cfg.name }}</span>
            <button
              v-if="configs.length > 1"
              class="del"
              title="删除该配置"
              @click.stop="removeConfig(cfg.id)"
            >×</button>
          </div>
        </div>
        <button class="add-config" @click="addConfig" title="新增配置">+ 配置</button>
      </aside>

      <!-- 任务栏 -->
      <section class="pane pane-tasks">
        <header class="pane-head">
          <h3 class="pane-title">任务栏</h3>
          <button class="pane-action add" @click="add">+ 添加脚本</button>
        </header>
        <div class="task-list">
          <div
            v-for="group in groupedItems"
            :key="group.timeKey"
            class="task-group"
          >
            <draggable
              :list="group.items"
              item-key="_bid"
              handle=".grip"
              :animation="50"
              ghost-class="drag-ghost"
              chosen-class="drag-chosen"
              @end="onGroupDragEnd(group)"
            >
              <template #item="{ element: s }">
                <TaskItem
                  :task="s"
                  :game-options="gameOptions"
                  :script-options="scriptOptions"
                  :adb-options="adbOptions"
                  :alas-config-options="alasConfigOptions"
                  :alas-configs-loading="alasConfigsLoading"
                  :alas-configs-error="alasConfigsError"
                  :running-bid="runningBid"
                  :last-run-at="lastRunMap[s._bid] || 0"
                  @remove="remove"
                  @name-change="autoMatchScript"
                  @pick-file="openFilePicker"
                  @run-now="runNow"
                />
              </template>
            </draggable>
          </div>

          <datalist id="adb-options">
            <option v-for="opt in adbOptions" :key="opt" :value="opt" />
          </datalist>

          <div v-if="!activeScripts.length" class="empty">
            当前配置还没有任务。点击右上"+ 添加脚本"开始。
          </div>
        </div>
      </section>

      <!-- 右栏：日志栏 -->
      <section class="pane pane-logs">
        <LogPanel />
      </section>
    </main>

    <input
      ref="fileInput"
      type="file"
      style="display: none"
      @change="onFilePicked"
    />

    <ConfigForm v-if="openPrograms" @close="openPrograms = false" />

    <!-- 游戏库管理 -->
    <GamesManager
      v-if="openGames"
      :games="games"
      :new-game="newGame"
      @close="openGames = false"
      @add-game="addGame"
      @remove-game="removeGame"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import { api } from './components/utils/api.js';
import {
  syncAll, syncState,
  ensureProgramsLoaded,
  programs,
} from './components/utils/sync.js';
import ConfigForm from './components/ConfigForm.vue';
import LogPanel from './components/LogPanel.vue';
import TaskItem from './components/TaskItem.vue';
import GamesManager from './components/GamesManager.vue';

// ============================================================
// 常量 & 持久化
// ============================================================
const STORAGE_KEY = 'agsl-data-v1';

const DEFAULT_LAUNCH_TIME = 6 * 60 + 30; // 06:30
const DEFAULT_DURATION = 2 * 60; // 02:00

function uid(prefix) {
  return (
    prefix +
    '_' +
    Date.now() +
    '_' +
    Math.floor(Math.random() * 100000).toString(36)
  );
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    // 兼容老数据：每个 script 补一个稳定的 _bid（后端 task id 不会变）、autoKill 字段
    if (data && Array.isArray(data.configs)) {
      const popupName = getPopupGameName(data.games);
      for (const cfg of data.configs) {
        for (const s of cfg.scripts || []) {
          if (!s._bid) s._bid = uid('bid');
          if (s.autoKill === undefined) s.autoKill = false;
          // 老数据兼容：空 name / 不匹配的 name 都不会让 sync 丢失 steps
          // 强制指向 popup 测试游戏（避免 alas/maa fallback 因为没程序而步骤全空）
          if (!s.name || !data.games?.some(g => g.name === s.name)) {
            s.name = popupName;
          }
        }
      }
    }
    return data;
  } catch (e) {
    console.warn('AGSL: 读取本地存储失败', e);
    return null;
  }
}

// fallback 优先找 script_id='test' 的游戏（popup 测试不需要外部路径）
// 不存在则退回任意一个有 name 的游戏，最后硬编码 '游戏1-测试' 兜底
function getPopupGameName(games) {
  if (!Array.isArray(games)) return '游戏1-测试';
  return games.find(g => g.script_id === 'test')?.name
      || games.find(g => g.name)?.name
      || '游戏1-测试';
}

function saveToStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('AGSL: 写入本地存储失败', e);
    return false;
  }
}

function buildDefaultData() {
  const cfg = {
    id: uid('cfg'),
    name: 'AGSL',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      defaultLaunchTime: DEFAULT_LAUNCH_TIME,
      defaultDuration: DEFAULT_DURATION,
    },
    scripts: [],
  };
  return {
    version: '1.0',
    lastUpdated: new Date().toISOString(),
    games: [
      { name: '碧蓝航线', script_id: 'alas', use_emulator: true, run_mode: 'foreground' },
      { name: '明日方舟', script_id: 'MAA', use_emulator: true, run_mode: 'foreground' },
      { name: '游戏1-测试', script_id: 'test', use_emulator: false, run_mode: 'foreground' },
    ],
    configs: [cfg],
    activeConfigId: cfg.id,
  };
}

// ============================================================
// 状态（启动时从 localStorage 读取）
// ============================================================
const initial = loadFromStorage() || buildDefaultData();

const games = ref(initial.games);
const configs = ref(initial.configs);
const activeConfigId = ref(initial.activeConfigId);

// 保存状态指示
const saveStatus = ref('saved'); // 'saved' | 'saving' | 'error'
let saveTimer = null;

const activeConfig = computed(
  () => configs.value.find((c) => c.id === activeConfigId.value) || configs.value[0]
);

// 当前激活配置的 scripts（模板里直接用这个）
const activeScripts = computed({
  get: () => activeConfig.value?.scripts ?? [],
  set: (v) => {
    if (activeConfig.value) activeConfig.value.scripts = v;
  },
});

const fileInput = ref(null);
let fileTarget = null;

// ============================================================
// 派生：游戏目录、游戏名/脚本下拉、adb 候选
// ============================================================
const gameOptions = computed(() => games.value.map((g) => g.name));
const scriptOptions = computed(() =>
  Array.from(new Set(games.value.map((g) => g.script_id)))
);
const gameIndex = computed(() =>
  Object.fromEntries(games.value.map((g) => [g.name, g]))
);

const adbOptions = computed(() => {
  const set = new Set();
  for (const s of activeScripts.value) {
    if (s.adb && s.adb.trim()) set.add(s.adb.trim());
  }
  return [...set];
});

// ALAS 配置名下拉: 从后端 API 拉 user config 列表
const alasConfigOptions = ref([])
const alasConfigsLoading = ref(false)
const alasConfigsError = ref('')
async function loadAlasConfigs() {
  // 找 programs.json 里 type='alas' 的 program
  const alasProg = programs.value.find(p => p.type === 'alas')
  if (!alasProg || !alasProg.path) {
    alasConfigOptions.value = []
    return
  }
  alasConfigsLoading.value = true
  alasConfigsError.value = ''
  try {
    const r = await api.alasConfigs(alasProg.path)
    alasConfigOptions.value = r.configs || []
  } catch (e) {
    alasConfigsError.value = e.message || String(e)
    alasConfigOptions.value = []
  } finally {
    alasConfigsLoading.value = false
  }
}
// 当 programs 变化时重拉 ALAS configs
watch(() => programs.value.map(p => `${p.type}:${p.path}`).join('|'), loadAlasConfigs)

// ============================================================
// 分组：同 launch_time 一组
// ============================================================
const groupedItems = computed(() => {
  const map = new Map();
  for (const s of activeScripts.value) {
    const k = s.launch_time;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(s);
  }
  const result = [];
  for (const [time, items] of map) {
    items.sort((a, b) => a.sortOrder - b.sortOrder);
    result.push({ timeKey: time, items });
  }
  result.sort((a, b) => a.timeKey - b.timeKey);
  return result;
});

// ============================================================
// 拖拽：把新位置写回 sortOrder
// ============================================================
function onGroupDragEnd(group) {
  group.items.forEach((item, i) => {
    item.sortOrder = i;
  });
}

// ============================================================
// 选游戏 → 自动回填 script_id / use_emulator / run_mode
// ============================================================
function autoMatchScript(s) {
  const meta = gameIndex.value[s.name];
  if (!meta) return;
  s.script_id = meta.script_id;
  s.use_emulator = meta.use_emulator;
  s.run_mode = meta.run_mode;
}

// ============================================================
// 增删任务
// ============================================================
function add() {
  const settings = activeConfig.value?.settings ?? {};
  // 默认 name 优先选 script_id='test' 的游戏（保证 popup 测试不需要任何外部 exe）
  const defaultName = games.value.find(g => g.script_id === 'test')?.name
                    || games.value[0]?.name
                    || '游戏1-测试';
  activeScripts.value.push({
    _bid: uid('bid'),
    script_id: games.value.find(g => g.name === defaultName)?.script_id ?? '',
    name: defaultName,
    launch_time: settings.defaultLaunchTime ?? DEFAULT_LAUNCH_TIME,
    duration: settings.defaultDuration ?? DEFAULT_DURATION,
    autoKill: false,
    adb: '',
    run_mode: 'foreground',
    use_emulator: true,
    game_location: '',
    active: true,
    expanded: true,
    sortOrder: nextSortOrder(),
  });
}

function remove(bid) {
  const list = activeScripts.value;
  const idx = list.findIndex((s) => s._bid === bid);
  if (idx >= 0) list.splice(idx, 1);
}

// 用最大 sortOrder + 1 给新任务分配，保证顺序稳定
function nextSortOrder() {
  let max = -1;
  for (const s of activeScripts.value) {
    if (s.sortOrder > max) max = s.sortOrder;
  }
  return max + 1;
}

// ============================================================
// 配置的增删切换
// ============================================================
function switchConfig(id) {
  if (id === activeConfigId.value) return;
  activeConfigId.value = id;
}

function addConfig() {
  const name = (prompt('新配置名称：') || '').trim();
  if (!name) return;
  const cfg = {
    id: uid('cfg'),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      defaultLaunchTime: DEFAULT_LAUNCH_TIME,
      defaultDuration: DEFAULT_DURATION,
    },
    scripts: [],
  };
  configs.value.push(cfg);
  activeConfigId.value = cfg.id;
}

function removeConfig(id) {
  if (configs.value.length <= 1) {
    alert('至少要保留一个配置');
    return;
  }
  const cfg = configs.find((c) => c.id === id);
  if (!cfg) return;
  if (!confirm(`确定删除配置"${cfg.name}"？该配置的所有任务会一起删除。`)) return;
  const idx = configs.value.findIndex((c) => c.id === id);
  configs.value.splice(idx, 1);
  if (activeConfigId.value === id) {
    activeConfigId.value = configs.value[0].id;
  }
}

// ============================================================
// 文件选择
// ============================================================
function openFilePicker(s) {
  fileTarget = s;
  if (fileInput.value) fileInput.value.value = '';
  fileInput.value?.click();
}

function onFilePicked(ev) {
  const f = ev.target.files && ev.target.files[0];
  if (f && fileTarget) {
    fileTarget.game_location = f.name;
  }
  fileTarget = null;
}

// ============================================================
// 自动保存：deep watch 整个数据，debounce 500ms 后写入 localStorage
// ============================================================
function scheduleSave() {
  saveStatus.value = 'saving';
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const payload = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      games: games.value,
      configs: configs.value,
      activeConfigId: activeConfigId.value,
    };
    if (activeConfig.value) {
      activeConfig.value.updatedAt = payload.lastUpdated;
    }
    const ok = saveToStorage(payload);
    saveStatus.value = ok ? 'saved' : 'error';
    // 异步推到后端：失败不影响 localStorage 保存
    try {
      await syncAll(configs.value, games.value, activeConfigId.value);
    } catch (e) {
      console.warn('sync 后端失败:', e);
    }
  }, 500);
}

// ============================================================
// 后端联动：立即启动、状态
// ============================================================
const openPrograms = ref(false);
const openGames = ref(false);
const newGame = ref({ name: '', script_id: '', use_emulator: true, run_mode: 'foreground' });
const lastRunMap = ref({});   // _bid -> 时间戳
const runningBid = ref(null); // 正在发请求的 _bid

function addGame() {
  if (!newGame.value.name || !newGame.value.script_id) return;
  games.value.push({ ...newGame.value });
  newGame.value = { name: '', script_id: '', use_emulator: true, run_mode: 'foreground' };
}
function removeGame(i) {
  games.value.splice(i, 1);
}

async function runNow(s) {
  if (!s._bid) {
    alert('此任务还未生成同步 id，请稍候');
    return;
  }
  runningBid.value = s._bid;
  try {
    await api.runTask(s._bid);
    lastRunMap.value = { ...lastRunMap.value, [s._bid]: Date.now() };
  } catch (e) {
    console.error('[runNow]', s.name, s._bid, e);
    alert('启动失败：' + (e.message || e));
  } finally {
    runningBid.value = null;
  }
}

// 启动时主动同步一次：把前端 localStorage 推到后端（即使没改字段也同步）
// 这样后端 tasks.json 不会卡在旧版（缺 steps、缺 cron）
ensureProgramsLoaded()
  .then(() => syncAll(configs.value, games.value, activeConfigId.value))
  .catch(e => console.warn('首次同步失败', e));

watch(
  () => activeScripts.value,    // 只看当前激活 config 的 scripts（其他不动）
  () => scheduleSave(),
  { deep: true, flush: 'post' }
);
watch(activeConfigId, () => scheduleSave());
watch(games, () => scheduleSave(), { deep: true, flush: 'post' });
</script>

<style>
/* =========================================================
   主题变量（全局共享给所有子组件的 var(--*)）
   ========================================================= */
:root {
  color-scheme: light dark;

  --bg: #ffffff;
  --bg-secondary: #f6f8fa;
  --bg-tertiary: #f0f4f8;
  --bg-input: #ffffff;

  --text: #1f2328;
  --text-secondary: #57606a;
  --text-tertiary: #8b949e;

  --border: #d0d7de;
  --border-light: #e1e4e8;

  --primary: #1a73e8;
  --primary-hover: #1557b0;
  --primary-focus: rgba(26, 115, 232, 0.2);
  --primary-soft: #e8f0fe;

  --danger: #c5221f;
  --danger-bg: #fce8e6;
  --danger-bg-hover: #fad9d6;
  --danger-border: #f5c2c0;

  --success: #1e7e34;
  --success-bg: #e6f4ea;
  --success-border: #34a853;

  --shadow-drag: rgba(0, 0, 0, 0.15);
  --ghost-bg: #e8f0fe;

  --sidebar-bg: #f6f8fa;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --bg-input: #0d1117;

    --text: #e6edf3;
    --text-secondary: #8b949e;
    --text-tertiary: #6e7681;

    --border: #30363d;
    --border-light: #21262d;

    --primary: #58a6ff;
    --primary-hover: #79b8ff;
    --primary-focus: rgba(88, 166, 255, 0.25);
    --primary-soft: #1f3a5f;

    --danger: #f85149;
    --danger-bg: #2d1416;
    --danger-bg-hover: #3d1a1f;
    --danger-border: #6e2a2a;

    --success: #3fb950;
    --success-bg: #0f2a17;
    --success-border: #2d6e3f;

    --shadow-drag: rgba(0, 0, 0, 0.5);
    --ghost-bg: #1f3a5f;

    --sidebar-bg: #161b22;
  }
}

/* ========================================================= */
html,
body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  width: 100%;
  height: 100%;
  max-height: 100vh;
  overflow: hidden;          /* body 永远不滚动；滚动交给 pane 内部 */
}

.app {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100%;
  height: 100vh;             /* UI 整体 = 100vh */
  max-height: 100vh;
  overflow: hidden;           /* 兜底：禁止任何子元素把 .app 撑出 viewport */
  position: relative;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Microsoft YaHei', sans-serif;
}

/* ---------- 顶部 topbar ---------- */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 24px;
  border: 1px solid var(--border);
  border-radius: 0;
  border-left: 0;
  border-right: 0;
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}
.brand-logo {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: var(--primary);
  line-height: 1;
}
.brand-tagline {
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.3px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.topbar-btn {
  padding: 5px 12px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.topbar-btn:hover {
  background: var(--bg-tertiary);
  border-color: var(--primary);
  color: var(--primary);
}
.topbar-info {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

/* ---------- 左侧配置栏 ---------- */
.config-sidebar {
  width: 100px;
  flex-shrink: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: fit-content;
  position: sticky;
  top: 16px;
}
.config-sidebar-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-tertiary);
  letter-spacing: 2px;
  margin-bottom: 2px;
}
.config-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.config-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text);
  border: 1px solid transparent;
  transition: background 0.1s;
}
.config-item:hover {
  background: var(--bg-tertiary);
}
.config-item.active {
  background: var(--primary-soft);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}
.config-item .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.config-item .del {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
  line-height: 1;
}
.config-item .del:hover {
  color: var(--danger);
}
.add-config {
  margin-top: 6px;
  padding: 8px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}
.add-config:hover {
  background: var(--bg-tertiary);
  color: var(--primary);
  border-color: var(--primary);
}

/* ---------- 主体两栏 ---------- */
.main {
  display: flex;
  gap: 14px;
  align-items: flex-start;     /* pane 自己有固定高度，不要 stretch */
  padding: 12px 24px;
  flex: 0 0 auto;              /* main 高度由 pane 高度决定 */
  overflow: hidden;            /* 兜底：main 内容不能溢出 .app */
  min-height: 0;
}
/* 任务栏和日志栏高度对齐 100vh - topbar - main padding（约 70+24=94px）。
   两个 pane 等高，跟视口绑定；内容超出时各自内部纵向滚动。
   宽度仍按 flex 比例（1.5 : 1.2）分。 */
.pane-tasks,
.pane-logs {
  height: calc(100vh - 94px);
  max-height: calc(100vh - 94px);
}
.pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  overflow: hidden;
}
.pane-tasks {
  flex: 1.5 1 0;
}
.pane-logs {
  flex: 1.2 1 0;
}
.pane-tasks > .task-list,
.pane-logs > .lp {
  flex: 1 1 0;
  min-height: 0;
}
.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-secondary);
  flex-shrink: 0;
}
.pane-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 1px;
}
.pane-action.add {
  padding: 4px 12px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}
.pane-action.add:hover {
  background: var(--primary-hover);
}
.pane-logs {
  /* 日志栏内部就是 LogPanel 组件，让它撑满 pane */
  padding: 0;
}
.pane-logs :deep(.lp) {
  border-radius: 0;
  border: none;
  min-height: 0;
  height: 100%;
}

/* ---------- saveStatus 颜色 ---------- */
.status {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  display: inline-block;
}
.status.saving {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}
.status.saved {
  background: var(--success-bg);
  color: var(--success);
}
.status.error {
  background: var(--danger-bg);
  color: var(--danger);
}

/* ---------- 任务列表（pane-tasks 内部） ---------- */
.pane-tasks > .task-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
}
.empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border: 1px dashed var(--border);
  border-radius: 6px;
  font-size: 14px;
}
.task-group {
  margin: 0;
}
.task-group + .task-group {
  margin-top: 8px;
}

/* ---------- 添加按钮 ---------- */
.add {
  margin-top: 16px;
  padding: 10px 20px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.add:hover {
  background: var(--primary-hover);
}

/* sync-indicator（顶栏用的） */
.sync-indicator {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  background: var(--bg-tertiary);
  color: var(--text-tertiary);
  font-weight: normal;
}
.sync-indicator.ok {
  background: var(--success-bg);
  color: var(--success);
}
.sync-indicator.fail {
  background: var(--danger-bg);
  color: var(--danger);
}
.sync-indicator small {
  font-size: 11px;
  opacity: 0.85;
  margin-left: 2px;
}

/* 通用弹窗（GamesManager + ConfigForm 都用） */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modal-card {
  background: var(--bg);
  color: var(--text);
  width: 760px;
  max-width: 92vw;
  max-height: 84vh;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.25);
}
.modal-head,
.modal-foot {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-head {
  border-bottom: 1px solid var(--border);
}
.modal-foot {
  border-top: 1px solid var(--border);
  justify-content: flex-end;
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-head .close {
  background: none;
  border: none;
  font-size: 22px;
  cursor: pointer;
  color: var(--text-secondary);
  line-height: 1;
  padding: 0 4px;
}
.modal-body {
  padding: 16px;
  overflow: auto;
  flex: 1;
}
.hint {
  color: var(--text-tertiary);
  font-size: 12px;
  margin: 0 0 12px;
}
.hint code {
  padding: 1px 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  font-size: 12px;
}
.programs-table {
  width: 100%;
  border-collapse: collapse;
}
.programs-table th,
.programs-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
  font-size: 13px;
}
.programs-table input,
.programs-table select {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}
.btn-cell,
.btn-cell-danger {
  padding: 4px 10px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.btn-cell-danger {
  color: var(--danger);
  border-color: var(--danger-border);
}
.btn-cell:hover:not(:disabled) {
  background: var(--bg-tertiary);
}
.btn-cell-danger:hover:not(:disabled) {
  background: var(--danger-bg-hover);
}
.btn-cell:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* inline-check 共享给 TaskItem 和 GamesManager */
.inline-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  color: var(--text);
  font-size: 13px;
  padding: 4px 0;
}
.inline-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary);
  margin: 0;
  cursor: pointer;
}

/* ---------- 拖拽样式（vuedraggable 的 ghost/chosen class） ---------- */
.drag-ghost {
  opacity: 0.4;
  background: var(--ghost-bg) !important;
  border-color: var(--primary) !important;
}
.drag-chosen {
  box-shadow: 0 4px 12px var(--shadow-drag);
}
</style>