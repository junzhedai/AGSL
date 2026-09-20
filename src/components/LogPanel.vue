<template>
  <div class="lp">
    <div class="lp-head">
      <span class="lp-title">运行日志</span>
      <span class="lp-info">
        {{ logs.length }} 条 · 最近 {{ lastTs ? formatTs(lastTs) : '-' }}
      </span>
      <span class="lp-spacer"></span>
      <button class="lp-btn" @click="autoScroll = !autoScroll" :title="autoScroll ? '停止自动滚到底部' : '继续自动滚到底部'">
        {{ autoScroll ? '⏸' : '▶' }}
      </button>
      <button class="lp-btn" @click="refreshNow" title="刷新一次">⟳</button>
      <button class="lp-btn" @click="clearLogs" title="清空（保留 INFO 一行 system log cleared）">🗑</button>
    </div>
    <div class="lp-body" ref="bodyRef" @scroll="onScroll">
      <div v-if="!logs.length" class="lp-empty">暂无日志</div>
      <div
        v-for="(line, i) in logs"
        :key="(line.ts || 0) + ':' + i"
        :class="['lp-line', `lvl-${line.level}`]"
      >
        <span class="lp-ts">{{ formatTs(line.ts) }}</span>
        <span class="lp-lvl">[{{ line.level }}]</span>
        <span v-if="line.type && line.type !== 'system'" class="lp-typ">[{{ line.type }}]</span>
        <span class="lp-msg">{{ line.msg }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const logs = ref([])
const autoScroll = ref(true)
const bodyRef = ref(null)
let timer = null
const lastTs = ref(0)

function formatTs(ts) {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}

async function refresh() {
  try {
    const el = bodyRef.value
    // 刷新前用户是否已经在底部：新内容进来后跟随滚动靠这个判断，
    // 不要在更新 logs 后再判断 scrollHeight，那时浏览器已经把 scrollTop 留在原位，
    // 新内容长度会让 "距底部距离" 一直 > 30px，自动滚动永远不再触发。
    const wasAtBottom = el
      ? Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 30
      : true
    const fresh = await fetch('/api/logs?tail=200').then(r => r.json())
    logs.value = Array.isArray(fresh) ? fresh : []
    lastTs.value = logs.value.length
      ? logs.value.reduce((m, l) => Math.max(m, l.ts || 0), 0)
      : 0
    if (autoScroll.value) {
      await nextTick()
      if (el) el.scrollTop = el.scrollHeight
    }
  } catch (e) {
    console.warn('[LogPanel] refresh failed', e)
  }
}

async function refreshNow() {
  await refresh()
}

function onScroll() {
  const el = bodyRef.value
  if (!el) return
  // 如果用户滚到底部，重新开启自动滚动；否则视为手动模式
  const atBottom = Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 30
  if (atBottom && !autoScroll.value) autoScroll.value = true
  else if (!atBottom && autoScroll.value) autoScroll.value = false
}

async function clearLogs() {
  try {
    await fetch('/api/logs', { method: 'DELETE' })
  } catch (e) {
    console.warn('[LogPanel] clear failed', e)
  }
  await refresh()
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 1500)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.lp {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Consolas', 'Cascadia Code', 'JetBrains Mono', 'Monaco', monospace;
  font-size: 12px;
  overflow: hidden;
  min-height: 0;
}
.lp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #252526;
  border-bottom: 1px solid #1a1a1a;
  flex-shrink: 0;
}
.lp-title {
  font-weight: 600;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.lp-info {
  font-size: 11px;
  color: #888;
}
.lp-spacer { flex: 1; }
.lp-btn {
  padding: 3px 8px;
  background: #3a3a3a;
  border: 1px solid #555;
  color: #ddd;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.lp-btn:hover { background: #4a4a4a; }

.lp-body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px;
  line-height: 1.5;
  scroll-behavior: smooth;
}
.lp-empty {
  color: #666;
  text-align: center;
  padding: 40px 0;
  font-style: italic;
}

.lp-line {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 0 2px;
}
.lp-line:hover {
  background: #2a2a2a;
}
.lp-ts {
  color: #6a6a6a;
  margin-right: 6px;
  font-size: 11px;
}
.lp-lvl {
  font-weight: 600;
  margin-right: 4px;
}
.lp-typ {
  color: #888;
  margin-right: 4px;
  font-size: 11px;
}
.lp-msg {
  color: inherit;
}

.lvl-INFO .lp-lvl { color: #569cd6; }
.lvl-WARN { color: #d7ba7d; }
.lvl-WARN .lp-lvl { color: #d7ba7d; }
.lvl-ERROR { color: #f48771; }
.lvl-ERROR .lp-lvl { color: #f48771; }
</style>
