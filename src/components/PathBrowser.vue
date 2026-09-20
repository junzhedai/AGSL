<template>
  <div class="modal-mask" @click.self="onClose">
    <div class="modal-card">
      <header class="modal-head">
        <h3>📂 选择程序路径</h3>
        <button class="close" @click="onClose" aria-label="关闭">×</button>
      </header>

      <div class="modal-body">
        <div class="path-bar">
          <button class="btn-icon" @click="goUp" :disabled="!canGoUp" title="上一层">⬆</button>
          <input
            ref="pathInputRef"
            v-model="pathInput"
            class="path-input"
            @keydown.enter="onPathEnter"
            @blur="onPathBlur"
            placeholder="C:\\Program Files\\..."
          />
          <button class="btn-icon" @click="reload" title="刷新">⟳</button>
        </div>

        <div v-if="error" class="error">{{ error }}</div>

        <div class="browser">
          <aside class="quick">
            <div class="quick-title">快速访问</div>
            <button
              v-for="qa in quickAccess"
              :key="qa.path"
              class="quick-item"
              :class="{ active: currentPath.toLowerCase() === qa.path.toLowerCase() }"
              @click="browse(qa.path)"
            >
              <span class="quick-icon">{{ qa.icon }}</span>
              {{ qa.label }}
            </button>
            <div class="quick-title" style="margin-top: 12px">盘符</div>
            <button
              v-for="d in drives"
              :key="d"
              class="quick-item"
              :class="{ active: currentPath.toLowerCase() === d.toLowerCase() + '\\' }"
              @click="browse(d + '\\')"
            >
              <span class="quick-icon">💾</span>
              {{ d }}\
            </button>
          </aside>

          <main class="entries">
            <div v-if="loading" class="loading">加载中…</div>
            <div v-else-if="!entries.length" class="empty">此目录为空</div>
            <div
              v-for="e in entries"
              :key="e.name"
              class="entry"
              :class="{ selected: selectedName === e.name }"
              @click="onSelect(e)"
              @dblclick="onDoubleClick(e)"
            >
              <span class="entry-icon">{{ e.type === 'dir' ? '📁' : '📄' }}</span>
              <span class="entry-name">{{ e.name }}</span>
              <span v-if="e.type === 'file'" class="entry-size">{{ formatSize(e.size) }}</span>
            </div>
          </main>
        </div>

        <div class="status-bar">
          选中: <code>{{ selectedFullPath || '(无)' }}</code>
        </div>
      </div>

      <footer class="modal-foot">
        <button class="btn" @click="onClose">取消</button>
        <button class="btn primary" :disabled="!selectedFullPath || !isFile" @click="onConfirm">
          选择
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api } from './utils/api.js'

const props = defineProps({
  open: Boolean,
  initialPath: { type: String, default: '' },
})
const emit = defineEmits(['close', 'select'])

const currentPath = ref('')
const pathInput = ref('')
const entries = ref([])
const drives = ref([])
const loading = ref(false)
const error = ref('')
const selectedName = ref('')
const selectedFullPath = ref('')
const isFile = ref(false)

const pathInputRef = ref(null)

const quickAccess = computed(() => [
  { label: '桌面',   icon: '🖥', path: `${(process.env.USERPROFILE || 'C:\\Users\\Default')}\\Desktop` },
  { label: '下载',   icon: '📥', path: `${(process.env.USERPROFILE || 'C:\\Users\\Default')}\\Downloads` },
  { label: '文档',   icon: '📄', path: `${(process.env.USERPROFILE || 'C:\\Users\\Default')}\\Documents` },
  { label: '自建工具', icon: '🛠', path: 'C:\\DAIJUNZHE' },
])

const canGoUp = computed(() => {
  const norm = currentPath.value.replace(/[\\/]+$/, '')
  return norm.length > 3 && norm.includes('\\')
})

watch(() => props.open, async (v) => {
  if (v) {
    await loadDrives()
    if (props.initialPath && props.initialPath.trim()) {
      await browse(props.initialPath)
    } else {
      await browse('C:\\')
    }
  }
}, { immediate: true })

async function loadDrives() {
  // 简单扫 [A-Z]:\
  const list = []
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c)
    try {
      await api.browseFs(letter + ':\\')
      list.push(letter + ':')
    } catch {}
  }
  drives.value = list
}

async function browse(target) {
  if (!target) return
  loading.value = true
  error.value = ''
  try {
    const r = await api.browseFs(target)
    currentPath.value = r.path
    pathInput.value = r.path
    entries.value = r.entries
    selectedName.value = ''
    selectedFullPath.value = ''
    isFile.value = false
  } catch (e) {
    error.value = e.message || String(e)
    entries.value = []
  } finally {
    loading.value = false
  }
}

async function reload() { await browse(currentPath.value) }

function goUp() {
  if (!canGoUp.value) return
  const norm = currentPath.value.replace(/[\\/]+$/, '')
  const parent = norm.substring(0, norm.lastIndexOf('\\'))
  browse(parent || (norm[0] + ':\\'))
}

function onPathEnter() {
  browse(pathInput.value)
}
function onPathBlur() {
  if (pathInput.value !== currentPath.value) pathInput.value = currentPath.value
}

function onSelect(entry) {
  selectedName.value = entry.name
  selectedFullPath.value = currentPath.value.replace(/[\\/]+$/, '') + '\\' + entry.name
  isFile.value = entry.type === 'file'
}
function onDoubleClick(entry) {
  if (entry.type === 'dir') {
    browse(selectedFullPath.value)
  } else {
    onSelect(entry)
    onConfirm()
  }
}

function onConfirm() {
  if (!selectedFullPath.value || !isFile.value) return
  emit('select', selectedFullPath.value)
  emit('close')
}
function onClose() {
  emit('close')
}

function formatSize(n) {
  if (n == null) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

onMounted(async () => {
  if (props.open) await loadDrives()
})
</script>

<style scoped>
.modal-mask {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  display: flex; align-items: center; justify-content: center;
}
.modal-card {
  background: var(--bg);
  color: var(--text);
  width: 880px;
  max-width: 96vw;
  max-height: 86vh;
  border-radius: 8px;
  border: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: 0 20px 50px rgba(0,0,0,0.3);
}
.modal-head, .modal-foot {
  padding: 12px 16px;
  display: flex; align-items: center; justify-content: space-between;
}
.modal-head { border-bottom: 1px solid var(--border); }
.modal-foot { border-top: 1px solid var(--border); justify-content: flex-end; gap: 8px; }
.modal-head h3 { margin: 0; font-size: 16px; }
.close {
  background: none; border: none; font-size: 22px; cursor: pointer;
  color: var(--text-secondary); padding: 0 4px;
}
.modal-body { padding: 14px 16px; flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 10px; }

.path-bar {
  display: flex; gap: 6px; align-items: center;
}
.btn-icon {
  padding: 4px 10px; background: var(--bg-input); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
}
.btn-icon:hover:not(:disabled) { background: var(--bg-tertiary); }
.btn-icon:disabled { opacity: 0.4; cursor: not-allowed; }
.path-input {
  flex: 1; padding: 6px 10px;
  border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-input); color: var(--text);
  font-family: 'Consolas', 'Cascadia Code', monospace; font-size: 13px;
}

.error {
  padding: 8px 12px; border: 1px solid var(--danger-border); border-radius: 4px;
  background: var(--danger-bg); color: var(--danger); font-size: 13px;
}

.browser {
  flex: 1; min-height: 380px;
  display: flex; gap: 10px;
  border: 1px solid var(--border); border-radius: 6px;
  overflow: hidden;
}
.quick {
  width: 160px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
  padding: 8px 6px;
  overflow-y: auto;
}
.quick-title {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  padding: 4px 8px; text-transform: uppercase;
}
.quick-item {
  width: 100%; text-align: left;
  padding: 6px 8px; background: transparent; border: none;
  color: var(--text); cursor: pointer; border-radius: 4px;
  font-size: 13px;
  display: flex; align-items: center; gap: 6px;
}
.quick-item:hover { background: var(--bg-tertiary); }
.quick-item.active { background: var(--primary-bg, #3a8fb7); color: white; }
.quick-icon { width: 16px; text-align: center; }

.entries {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.entry {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}
.entry:hover { background: var(--bg-tertiary); }
.entry.selected { background: var(--primary-bg, #3a8fb7); color: white; }
.entry-icon { width: 16px; text-align: center; }
.entry-name { flex: 1; }
.entry-size { font-size: 11px; color: var(--text-tertiary); }
.loading, .empty {
  padding: 40px 0; text-align: center;
  color: var(--text-tertiary); font-style: italic;
}

.status-bar {
  padding: 6px 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.status-bar code {
  padding: 2px 6px; background: var(--bg-tertiary); border-radius: 3px;
  font-family: 'Consolas', monospace; font-size: 11px;
}

.btn {
  padding: 6px 14px; background: var(--bg-input); color: var(--text);
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
  font-size: 13px;
}
.btn:hover:not(:disabled) { background: var(--bg-tertiary); }
.btn.primary { background: #3a8fb7; color: white; border-color: #3a8fb7; }
.btn.primary:hover:not(:disabled) { background: #4a9fc7; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>