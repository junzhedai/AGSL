<template>
  <div class="modal-mask" @click.self="onClose">
    <div class="modal-card">
      <header class="modal-head">
        <h3>程序管理</h3>
        <button class="close" @click="onClose" aria-label="关闭">×</button>
      </header>

      <div class="modal-body">
        <div class="toolbar">
          <button class="btn" @click="onDetect" :disabled="detecting">
            {{ detecting ? '检测中…' : '自动检测已安装程序' }}
          </button>
          <span class="hint">扫不到的程序（如 MAA / ALAS / BetterGi）需手动添加</span>
        </div>

        <p v-if="!programs.length" class="empty">
          还没配置任何程序。先点上方按钮扫一遍，或者下方手动加。
        </p>

        <table v-else class="programs-table">
          <thead>
            <tr>
              <th style="width: 28%">名称</th>
              <th style="width: 130px">类型</th>
              <th>路径</th>
              <th style="width: 96px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in programs" :key="p.id">
              <td>
                <span class="name-display" :title="p.name">
                  {{ p.name || deriveName(p) }}
                </span>
              </td>
              <td><code>{{ p.type }}</code></td>
              <td class="path-cell">
                <span class="path-display" :title="p.path">{{ p.path || '(未设置)' }}</span>
              </td>
              <td class="row-actions">
                <button class="btn-icon" title="选择路径" @click="openBrowserFor(p)">📁</button>
                <button class="btn danger" @click="remove(p.id)">删</button>
              </td>
            </tr>
            <!-- 新增行 -->
            <tr class="new-row">
              <td>
                <span class="name-display new">新程序</span>
              </td>
              <td>
                <select v-model="newP.type">
                  <option value="" disabled>选择类型</option>
                  <option v-for="t in KNOWN_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td class="path-cell">
                <input v-model="newP.path" placeholder="点 📁 浏览 或手动输入" />
              </td>
              <td class="row-actions">
                <button class="btn-icon" :disabled="!newP.type" title="浏览" @click="openBrowserForNew">📁</button>
                <button class="btn primary" :disabled="!canAdd" @click="add">+</button>
              </td>
            </tr>
          </tbody>
        </table>

        <p class="footnote">
          已知 type：<code>mumu12</code> / <code>ldplayer</code> / <code>bluestacks</code> /
          <code>maa</code> / <code>alas</code> / <code>bettergi</code> /
          <code>genshin-launcher</code> / <code>genshin-direct</code>
        </p>
        <p class="footnote">"名称"从路径自动派生（不可改），避免重复字段。</p>
      </div>

      <footer class="modal-foot">
        <button class="btn" @click="onClose">关闭</button>
      </footer>
    </div>

    <PathBrowser
      v-if="browserOpen"
      :open="browserOpen"
      :initial-path="browserInitialPath"
      @close="browserOpen = false"
      @select="onPathSelected"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { api } from './utils/api.js'
import { runAutoDetect } from './utils/sync.js'
import PathBrowser from './PathBrowser.vue'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['close'])

const KNOWN_TYPES = [
  'mumu12', 'ldplayer', 'bluestacks',
  'maa', 'alas', 'bettergi',
  'genshin-launcher', 'genshin-direct',
]

const programs = ref([])
const detecting = ref(false)
const newP = ref({ type: '', path: '' })

const browserOpen = ref(false)
const browserInitialPath = ref('')
const browserTarget = ref(null)   // null=新建行, 否则为某个 program 对象

const canAdd = computed(() => newP.value.type && newP.value.path && newP.value.path.trim())

// 从 path 派生 name（去掉扩展名和目录）
function deriveName(p) {
  if (!p || !p.path) return '(空)'
  // 取 basename
  const parts = p.path.split(/[\\/]/).filter(Boolean)
  const base = parts[parts.length - 1] || p.path
  // 去扩展名
  const noExt = base.replace(/\.(exe|bat|cmd|sh|ps1)$/i, '')
  return noExt
}

async function load() {
  try {
    const list = await api.getPrograms()
    programs.value = list
  } catch (e) {
    console.warn('[ConfigForm] 加载失败', e)
  }
}

watch(() => props.open, async (v) => {
  if (v) await load()
}, { immediate: true })

async function onDetect() {
  detecting.value = true
  try {
    await runAutoDetect()
    await load()
  } finally {
    detecting.value = false
  }
}

function openBrowserFor(p) {
  browserTarget.value = p
  browserInitialPath.value = p.path || ''
  browserOpen.value = true
}

function openBrowserForNew() {
  browserTarget.value = null
  browserInitialPath.value = newP.value.path || ''
  browserOpen.value = true
}

async function onPathSelected(pickedPath) {
  if (browserTarget.value) {
    browserTarget.value.path = pickedPath
  } else {
    newP.value.path = pickedPath
  }
  browserOpen.value = false
  // 编辑已有 program 时立即保存；新增行等用户点 +
  if (browserTarget.value) {
    await save()
  }
}

async function add() {
  if (!canAdd.value) return
  const id = 'm_' + Date.now().toString(36)
  const newProgram = {
    id,
    type: newP.value.type,
    name: deriveName({ path: newP.value.path }),
    path: newP.value.path,
  }
  programs.value.push(newProgram)
  newP.value = { type: '', path: '' }
  await save()
}

async function remove(id) {
  const idx = programs.value.findIndex(p => p.id === id)
  if (idx < 0) return
  programs.value.splice(idx, 1)
  await save()
}

async function save() {
  try {
    await api.putPrograms(programs.value)
  } catch (e) {
    console.warn('[ConfigForm] 保存失败', e)
    alert('保存失败：' + (e.message || e))
  }
}

async function onClose() {
  emit('close')
}
</script>

<style scoped>
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
  width: 820px;
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
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.btn {
  padding: 6px 14px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}
.btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
}
.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.btn.danger {
  color: var(--danger);
  border-color: var(--danger-border);
}
.btn.danger:hover:not(:disabled) {
  background: var(--danger-bg-hover);
}
.btn.primary {
  background: #3a8fb7;
  color: white;
  border-color: #3a8fb7;
}
.btn.primary:hover:not(:disabled) {
  background: #4a9fc7;
}
.btn-icon {
  padding: 4px 10px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.btn-icon:hover:not(:disabled) {
  background: var(--bg-tertiary);
}
.btn-icon:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.empty {
  padding: 16px;
  text-align: center;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border: 1px dashed var(--border);
  border-radius: 6px;
  margin: 0 0 12px;
}
.programs-table {
  width: 100%;
  border-collapse: collapse;
}
.programs-table th,
.programs-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
  font-size: 13px;
  vertical-align: middle;
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
.name-display {
  display: inline-block;
  max-width: 100%;
  padding: 4px 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);
  border-radius: 4px;
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.name-display.new {
  font-weight: normal;
  color: var(--text-tertiary);
  font-style: italic;
}
.path-cell {
  max-width: 0;
  overflow: hidden;
}
.path-display {
  display: inline-block;
  max-width: 100%;
  font-family: 'Consolas', 'Cascadia Code', monospace;
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.row-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
}
code {
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  font-size: 12px;
}
.footnote {
  color: var(--text-tertiary);
  font-size: 12px;
  margin: 10px 0 0;
}
</style>