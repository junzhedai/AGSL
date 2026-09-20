# AGSL — Automatic Game Script Launcher

碧蓝航线 / 明日方舟 / 原神 / 终末地 / 异环等游戏的脚本调度 UI。在浏览器里维护时间表，后端用 `node-schedule` 按 cron 自动跑，配合 ALAS / MAA / BetterGi 等工具。

前端 Vue 3 + Vite，后端 Express + node-schedule，两个独立进程，Vite dev server 把 `/api/*` 反代到后端。

---

## 快速启动

需要 Node.js 22+（推荐 24+，见 `package.json` 的 `engines`）。

### Windows（推荐）

```
双击 start-agsl.bat
```

会做这些事：

1. 第一次跑自动 `npm install` 装后端依赖
2. 清掉旧的后端进程（端口 5180）
3. 隐藏窗口启动后端 `node server.js`
4. 起一个独立窗口跑 `npm run dev`（前端 Vite）
5. 后端就绪后自动打开浏览器 `http://localhost:5173`

PID 写到 `.agsl-pids.json`，关掉 AGSL-Vite 窗口就停了，或跑 `stop-agsl.bat` 全部清掉。

### 手动（开发用）

两个终端窗口：

```powershell
# 终端 1：后端
cd scheduled-tasks-backend
npm install        # 第一次跑
node server.js     # http://127.0.0.1:5180

# 终端 2：前端
npm install        # 第一次跑
npm run dev        # http://localhost:5173 或 http://127.0.0.1:5173
```

Vite 把 `/api/*` 反代到后端 5180，所以浏览器只要访问 5173 就够。

---

## 目录结构

```
AGSL/
├── src/                          # 前端 Vue 3 + TS
│   ├── App.vue                   # 顶栏 / 配置栏 / 任务栏 / 日志栏 容器
│   ├── main.ts
│   ├── env.d.ts                  # *.vue shim（type-check 需要）
│   ├── components/
│   │   ├── TaskItem.vue          # 单个任务卡片（展开/收起/拖拽）
│   │   ├── GamesManager.vue      # 游戏库管理 modal
│   │   ├── ConfigForm.vue        # 程序管理 modal（检测 / 配置 program）
│   │   ├── LogPanel.vue          # 日志栏
│   │   └── utils/
│   │       ├── api.js            # 前端 → 后端 fetch 封装
│   │       └── sync.js           # localStorage ↔ 后端 tasks.json 同步
│   └── ...
├── scheduled-tasks-backend/      # 后端 Express + node-schedule
│   ├── server.js                 # 入口（启动 HTTP + scheduler）
│   ├── src/
│   │   ├── scheduler.js          # cron 调度 + runTask
│   │   ├── launcher.js           # 启动模拟器 / 游戏 / 脚本
│   │   ├── config.js             # programs.json / configs.json 加载与迁移
│   │   ├── api.js                # REST 路由
│   │   └── ...
│   ├── data/                     # 运行时数据（programs.json / tasks.json / configs.json）
│   └── server.log                # 后端日志
├── vite.config.ts                # host:true 双栈 + /api proxy
├── start-agsl.bat / .ps1         # 一键启动
├── stop-agsl.bat / .ps1          # 一键停止
└── .agsl-pids.json               # 启动脚本写入的 PID 列表
```

---

## 启动后用

打开 `http://localhost:5173`，UI 分四块：

1. **顶栏**：保存状态、向后端同步状态、"游戏库" / "程序管理" 入口
2. **左侧配置栏**：可以建多个独立 config，每个有自己的一组任务
3. **任务栏**：所有任务卡，按启动时间分组、组内可拖拽排序
4. **日志栏**：后端 1.5s 拉一次，可暂停自动滚动 / 手动刷新 / 清空

任务卡展开后能设：

- 游戏名（下拉，从"游戏库"里选；改名会自动回填 script_id / use_emulator / run_mode）
- 脚本类型（下拉）
- 启动时间（HH:MM 加减器）
- 持续时长（HH:MM 加减器）
- 结束模式（默认让脚本自己退 / 时间到自动 kill）
- 运行模式（前台 / 后台）
- 模拟器 serial（自动从所有任务的 serial 里凑成下拉建议项）
- ALAS 配置名（仅 `script_id === 'alas'` 时显示）
- 游戏路径（仅 `use_emulator === false` 时显示 + 弹文件选择器）
- 立即启动按钮（不管定时是否启用，都可手动触发）

---

## 配置 / 数据文件

前端数据 100% 走 `localStorage`（key: `agsl-data-v1`），刷新页不丢。改完字段 500ms debounce 后：

1. 写回 localStorage
2. 推一份给后端 `/api/sync`，后端写 `scheduled-tasks-backend/data/tasks.json` 和 `configs.json`

后端独有的：

- `data/programs.json` — 检测到的 program 列表（路径 / type / name）。在 UI 的"程序管理"里可以手动改
- `server.log` / `server.log.err` — 后端 stdout / stderr
- `data/tasks.json` — 同步过来的任务（带 `_bid` 作为稳定 id，scheduler 用它做 cron key）

---

## 故障排查

**Q：`http://127.0.0.1:5173` 打不开，只 `http://localhost:5173` 能开**
A：已经修了，`vite.config.ts` 设了 `host: true`（IPv4/IPv6 双栈）。如果还不行，看 Vite 启动日志确认报的是 `0.0.0.0` 还是 `::`。

**Q：`npm run build` 报 `vue-tsc` 退出 2**
A：`env.d.ts` 缺 `*.vue` shim。文件里有，已经加了；如果还报，看 `env.d.ts` 第一行是不是 `/// <reference types="vite/client" />`。

**Q：任务列表里"立即启动"按钮点不动 / 一直转圈**
A：看后端 `server.log` 是不是有 spawn 报错。常见原因是模拟器路径不对、port 被占，去"程序管理"里点"自动搜索"重找路径。

**Q：cron 时间到了但任务没跑**
A：看"日志栏"，如果连 `step-start` 都没打出来，说明 scheduler 没注册——确认前端保存按钮是"已保存"（不是"保存失败"），且后端 `data/tasks.json` 有这条任务。

**Q：改了 ALAS 路径 / 加了 task，但日志栏一直显示旧的名字（`undefined`）**
A：重启后端（`stop-agsl.bat` + `start-agsl.bat`）。`scheduler.js` 里读取的是启动时的 program 快照，热重载不会刷新。

**Q：拖拽顺序乱了 / 拖完没保存**
A：拖完会自动触发 debounce 500ms 保存。如果没保存，检查顶栏是不是"保存失败"（红字）——可能是同步到后端失败但 localStorage 已写，刷新页就好。

**Q：lightningcss 警告 `:deep is not recognized`**
A：Vue 3 scoped CSS 用 `:deep()`，是 Vue 编译器语法，lightningcss 不识别。build EXIT=0，警告不影响产物，不用管。等 vite 升级或换 CSS minifier 会消。

---

## 开发提示

- 前端热更新：改 `src/**` 直接 HMR，不用重启
- 后端热更新：要重启（`stop-agsl.bat` + `start-agsl.bat`）
- 类型检查：`npm run build` 会跑 `vue-tsc --build`，比纯 `vite build` 严格
- 浏览器开发者工具：右上角有 Vue DevTools 入口（`Alt+Shift+D`）
- 本人算个小白，这个应用主要是AI辅助开发的

---

## 已知 P2（不影响生产，看时间再做）

- `launcher.js:532` 用 `name:` 字段（已统一，`config.js` migration 兼容老 `displayName`）
- `loadFromStorage` 的 popup 游戏回退链已抽到 `getPopupGameName(games)` 工具函数
- `App.vue` 已拆 `<TaskItem>` / `<GamesManager>` 两个子组件
- 日志栏 `LogPanel.vue` 自动滚动：`refresh()` 前先记录 `wasAtBottom`，新内容进来后无脑滚到底
