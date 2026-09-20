<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card">
      <header class="modal-head">
        <h3>游戏库</h3>
        <button class="close" @click="$emit('close')" aria-label="关闭">×</button>
      </header>
      <div class="modal-body">
        <p class="hint">
          每条游戏对应一种 script（如 <code>alas</code> / <code>MAA</code> / <code>BetterGI</code> / <code>test</code>）。
          任务下拉里的"游戏名"会引用这里。
        </p>
        <table class="games-table">
          <thead>
            <tr>
              <th style="width: 30%">游戏名</th>
              <th style="width: 25%">script_id</th>
              <th>模拟器</th>
              <th>前台/后台</th>
              <th style="width: 60px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(g, i) in games" :key="i">
              <td><input v-model="g.name" /></td>
              <td><input v-model="g.script_id" placeholder="alas / MAA / test" /></td>
              <td>
                <label class="inline-check">
                  <input type="checkbox" v-model="g.use_emulator" /> 是
                </label>
              </td>
              <td>
                <select v-model="g.run_mode">
                  <option value="foreground">前台</option>
                  <option value="background">后台</option>
                </select>
              </td>
              <td><button class="btn-cell-danger" @click="$emit('remove-game', i)">删</button></td>
            </tr>
            <tr>
              <td><input v-model="newGame.name" placeholder="新游戏名" /></td>
              <td><input v-model="newGame.script_id" placeholder="script_id" /></td>
              <td>
                <label class="inline-check">
                  <input type="checkbox" v-model="newGame.use_emulator" /> 是
                </label>
              </td>
              <td>
                <select v-model="newGame.run_mode">
                  <option value="foreground">前台</option>
                  <option value="background">后台</option>
                </select>
              </td>
              <td>
                <button
                  class="btn-cell"
                  :disabled="!newGame.name || !newGame.script_id"
                  @click="$emit('add-game')"
                >+</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="hint">
          已知的 script_id：<code>alas</code>、<code>MAA</code>、<code>BetterGI</code>、
          <code>MAA_END</code>、<code>MAA_NTE</code>、<code>test</code>（"游戏1-测试"）。
        </p>
      </div>
      <footer class="modal-foot">
        <button class="btn-cell" @click="$emit('close')">关闭</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
defineProps({
  games: { type: Array, required: true },
  newGame: { type: Object, required: true },
});

defineEmits([
  'close',
  'add-game',
  'remove-game',
]);
</script>

<style scoped>
.games-table {
  width: 100%;
  border-collapse: collapse;
}
.games-table th,
.games-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-light);
  text-align: left;
  font-size: 13px;
}
.games-table input,
.games-table select {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}
</style>