<template>
  <div class="task" :class="{ expanded: task.expanded }">
    <div class="task-header">
      <span class="grip" title="按住拖动排序">≡</span>
      <button
        class="toggle"
        :aria-label="task.expanded ? '收起详情' : '展开详情'"
        @click="task.expanded = !task.expanded"
      >
        {{ task.expanded ? '◀' : '▼' }}
      </button>
      <span class="name">{{ task.name || '(未命名)' }}</span>
      <span class="mode">【{{ runModeLabel(task.run_mode) }}】</span>
      <span class="time-pill">{{ formatTime(task.launch_time) }}</span>
      <label
        class="active-toggle"
        :class="{ on: task.active, off: !task.active }"
        :title="task.active ? '已启用' : '未启用'"
      >
        <input type="checkbox" v-model="task.active" />
        <span class="icon">{{ task.active ? '✓' : '✗' }}</span>
      </label>
      <button class="remove" @click="$emit('remove', task._bid)">删除</button>
    </div>

    <div v-if="task.expanded" class="task-detail">
      <div class="field">
        <label>游戏名</label>
        <select v-model="task.name" @change="$emit('name-change', task)">
          <option disabled value="">请选择游戏</option>
          <option v-for="g in gameOptions" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>

      <div class="field">
        <label>脚本</label>
        <select v-model="task.script_id">
          <option value="">自动匹配</option>
          <option v-for="opt in scriptOptions" :key="opt" :value="opt">{{ opt }}</option>
        </select>
      </div>

      <div class="field">
        <label>启动时间</label>
        <div class="time-stepper">
          <div class="digit">
            <button :disabled="!canBump(task.launch_time, 600)" @click="bump(task, 'launch_time', 600)">▲</button>
            <span class="num">{{ digitAt(task.launch_time, 600, 6000) }}</span>
            <button :disabled="!canBump(task.launch_time, -600)" @click="bump(task, 'launch_time', -600)">▼</button>
          </div>
          <div class="digit">
            <button :disabled="!canBump(task.launch_time, 60)" @click="bump(task, 'launch_time', 60)">▲</button>
            <span class="num">{{ digitAt(task.launch_time, 60, 600) }}</span>
            <button :disabled="!canBump(task.launch_time, -60)" @click="bump(task, 'launch_time', -60)">▼</button>
          </div>
          <span class="colon">:</span>
          <div class="digit">
            <button :disabled="!canBump(task.launch_time, 10)" @click="bump(task, 'launch_time', 10)">▲</button>
            <span class="num">{{ digitAt(task.launch_time, 10, 60) }}</span>
            <button :disabled="!canBump(task.launch_time, -10)" @click="bump(task, 'launch_time', -10)">▼</button>
          </div>
          <div class="digit">
            <button :disabled="!canBump(task.launch_time, 1)" @click="bump(task, 'launch_time', 1)">▲</button>
            <span class="num">{{ digitAt(task.launch_time, 1, 10) }}</span>
            <button :disabled="!canBump(task.launch_time, -1)" @click="bump(task, 'launch_time', -1)">▼</button>
          </div>
          <button class="reset" @click="task.launch_time = 390" title="重置为 06:30">⟲</button>
        </div>
      </div>

      <div class="field">
        <label>持续时长</label>
        <div class="time-stepper">
          <div class="digit">
            <button :disabled="!canBump(task.duration, 600)" @click="bump(task, 'duration', 600)">▲</button>
            <span class="num">{{ digitAt(task.duration, 600, 6000) }}</span>
            <button :disabled="!canBump(task.duration, -600)" @click="bump(task, 'duration', -600)">▼</button>
          </div>
          <div class="digit">
            <button :disabled="!canBump(task.duration, 60)" @click="bump(task, 'duration', 60)">▲</button>
            <span class="num">{{ digitAt(task.duration, 60, 600) }}</span>
            <button :disabled="!canBump(task.duration, -60)" @click="bump(task, 'duration', -60)">▼</button>
          </div>
          <span class="colon">:</span>
          <div class="digit">
            <button :disabled="!canBump(task.duration, 10)" @click="bump(task, 'duration', 10)">▲</button>
            <span class="num">{{ digitAt(task.duration, 10, 60) }}</span>
            <button :disabled="!canBump(task.duration, -10)" @click="bump(task, 'duration', -10)">▼</button>
          </div>
          <div class="digit">
            <button :disabled="!canBump(task.duration, 1)" @click="bump(task, 'duration', 1)">▲</button>
            <span class="num">{{ digitAt(task.duration, 1, 10) }}</span>
            <button :disabled="!canBump(task.duration, -1)" @click="bump(task, 'duration', -1)">▼</button>
          </div>
          <button class="reset" @click="task.duration = 120" title="重置为 02:00">⟲</button>
        </div>
      </div>

      <div class="field">
        <label>结束模式</label>
        <label class="inline-check">
          <input type="checkbox" v-model="task.autoKill" />
          {{ task.autoKill ? `时间到自动关闭（持续 ${formatTime(task.duration)}）` : '默认（让脚本自己退出）' }}
        </label>
      </div>

      <div class="field">
        <label>运行模式</label>
        <select v-model="task.run_mode">
          <option value="background">后台</option>
          <option value="foreground">前台</option>
        </select>
      </div>

      <div class="field">
        <label>模拟器serial</label>
        <input
          list="adb-options"
          v-model="task.adb"
          placeholder="arknights_test / emulator-5555"
        />
      </div>

      <div class="field" v-if="task.script_id === 'alas'">
        <label>ALAS 配置名</label>
        <select v-model="task.alasConfig" :disabled="alasConfigsLoading">
          <option value="">自动匹配 (按任务名)</option>
          <option v-for="c in alasConfigOptions" :key="c.name" :value="c.name">
            {{ c.name }}{{ c.hasEnabled ? '' : ' (无启用 task)' }}
          </option>
        </select>
        <span class="hint" v-if="alasConfigsError">⚠ {{ alasConfigsError }}</span>
        <span class="hint" v-else-if="alasConfigOptions.length === 0">ALAS 目录下没找到 user config（先去 ALAS GUI 配任务）</span>
      </div>

      <div class="field" v-if="!task.use_emulator">
        <label>游戏路径</label>
        <div class="path-row">
          <input
            type="text"
            v-model="task.game_location"
            placeholder="点击右侧选择文件..."
            readonly
          />
          <button @click="$emit('pick-file', task)">选择</button>
        </div>
      </div>

      <div class="field run-now-field">
        <label>操作</label>
        <button
          class="btn-run"
          :disabled="runningBid === task._bid"
          :title="task.active ? '立即按步骤启动模拟器/游戏/脚本' : '未启用定时，但手动立即启动仍可用'"
          @click="$emit('run-now', task)"
        >
          {{ runningBid === task._bid ? '启动中…' : '▶ 立即启动' }}
        </button>
        <span class="run-hint" v-if="lastRunAt">
          最近：{{ formatTimeAgo(lastRunAt) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { formatTimeAgo } from './utils/sync.js';

const props = defineProps({
  task: { type: Object, required: true },
  gameOptions: { type: Array, required: true },
  scriptOptions: { type: Array, required: true },
  adbOptions: { type: Array, required: true },
  alasConfigOptions: { type: Array, required: true },
  alasConfigsLoading: { type: Boolean, default: false },
  alasConfigsError: { type: String, default: '' },
  runningBid: { type: String, default: null },
  lastRunAt: { type: Number, default: 0 },
});

defineEmits([
  'remove',
  'name-change',
  'pick-file',
  'run-now',
]);

const MAX_MINUTES = 23 * 60 + 59; // 1439

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}
function formatTime(min) {
  return pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
}
function runModeLabel(m) {
  return m === 'foreground' ? '前台' : '后台';
}
function digitAt(min, place, wrap) {
  return Math.floor((min % wrap) / place);
}
function canBump(current, delta) {
  const next = current + delta;
  return next >= 0 && next <= MAX_MINUTES;
}
function bump(s, key, delta) {
  if (!canBump(s[key], delta)) return;
  s[key] = s[key] + delta;
}
</script>

<style scoped>
.task {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  background: var(--bg);
}
.task + .task {
  border-top: none;
}
.task:first-child {
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
}
.task:last-child {
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
}
.task.expanded {
  border-color: var(--primary);
}

.task-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--text);
  min-width: 0;
}
.task-header > .name {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-header > .mode {
  flex-shrink: 0;
  white-space: nowrap;
}
.task-header > .time-pill {
  flex-shrink: 0;
  white-space: nowrap;
}
.grip {
  cursor: grab;
  color: var(--text-tertiary);
  font-size: 16px;
  user-select: none;
  padding: 0 2px;
}
.grip:active {
  cursor: grabbing;
}
.toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  color: var(--text-secondary);
  width: 20px;
}
.name {
  font-weight: 600;
  min-width: 60px;
  color: var(--text);
}
.mode {
  color: var(--text-secondary);
  font-size: 13px;
}
.time-pill {
  margin-left: auto;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 2px 8px;
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: var(--text);
}
.active-toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
}
.active-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.active-toggle .icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-secondary);
}
.active-toggle.on .icon {
  background: var(--success-bg);
  border-color: var(--success-border);
  color: var(--success);
}
.active-toggle.off .icon {
  background: var(--danger-bg);
  border-color: var(--danger-border);
  color: var(--danger);
}
.remove {
  background: var(--bg);
  color: var(--danger);
  border: 1px solid var(--danger-border);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.remove:hover {
  background: var(--danger-bg-hover);
}

.task-detail {
  padding: 12px 16px 16px;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.field > label {
  width: 90px;
  color: var(--text-secondary);
  font-size: 13px;
  flex-shrink: 0;
}
.field > select,
.field > input {
  flex: 1 1 0;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
  background: var(--bg-input);
  color: var(--text);
}
.field > select:focus,
.field > input:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 2px var(--primary-focus);
}

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

.time-stepper {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.time-stepper .digit {
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
}
.time-stepper .digit button {
  width: 28px;
  height: 18px;
  font-size: 10px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}
.time-stepper .digit button:hover:not(:disabled) {
  background: var(--bg-tertiary);
}
.time-stepper .digit button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.time-stepper .digit button:first-child {
  border-bottom: none;
  border-radius: 3px 3px 0 0;
}
.time-stepper .digit button:last-child {
  border-radius: 0 0 3px 3px;
}
.time-stepper .digit .num {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  padding: 2px 6px;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  min-width: 28px;
  text-align: center;
  background: var(--bg-input);
  color: var(--text);
}
.time-stepper .colon {
  font-size: 18px;
  font-weight: 600;
  padding: 0 2px;
  color: var(--text);
}
.time-stepper .reset {
  margin-left: 8px;
  padding: 4px 8px;
  font-size: 14px;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  border-radius: 4px;
  cursor: pointer;
}
.time-stepper .reset:hover {
  background: var(--bg-tertiary);
}

.path-row {
  display: flex;
  gap: 6px;
  flex: 1;
}
.path-row input {
  flex: 1;
}
.path-row button {
  padding: 6px 12px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.path-row button:hover {
  background: var(--bg-tertiary);
}

.run-now-field {
  padding-top: 8px;
  margin-top: 4px;
  border-top: 1px dashed var(--border-light);
}
.btn-run {
  padding: 6px 16px;
  background: var(--success);
  color: #fff;
  border: 1px solid var(--success-border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.btn-run:hover:not(:disabled) {
  filter: brightness(0.92);
}
.btn-run:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.run-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-left: 8px;
}
</style>