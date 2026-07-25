# Pi Web

[English](./README.md)

[pi 编程智能体](https://github.com/badlogic/pi-mono) 的本地 Web UI（可选桌面端）。Pi Web 读取本机 pi 会话文件，在浏览器里提供实时对话、会话管理、模型/技能配置、Git 审查、内置终端和项目文件预览。

本仓库为维护中的二开版本：在上游 pi web 能力之上，增加了 Electron 桌面打包、Git/终端工作区、中英文界面等增强。

## 环境要求

- Node.js 20+
- 可用的 [pi](https://github.com/badlogic/pi-mono) agent 环境（默认 `~/.pi/agent`：会话、模型、鉴权等）

## 快速开始

**无需安装，直接运行：**

```bash
npx @agegr/pi-web@latest
```

**或全局安装后使用：**

```bash
npm install -g @agegr/pi-web
pi-web
```

启动后打开 [http://localhost:30141](http://localhost:30141)。CLI 会在服务就绪后尝试自动打开浏览器。

**可选参数：**

```bash
pi-web --port 8080              # 自定义端口
pi-web --hostname 127.0.0.1     # 仅本机访问（推荐）
pi-web -p 8080 -H 127.0.0.1     # 组合使用
pi-web --no-open                # 不自动打开浏览器

PORT=8080 pi-web                # 也支持环境变量
PI_WEB_NO_OPEN=1 pi-web         # 适用于后台服务或开机自启
```

> **安全提示：** 应用本身没有登录鉴权。若主机对不可信网络可达，请绑定 `127.0.0.1`。Electron 桌面版默认只监听本机回环地址。

## 桌面端（Electron）

Pi Web 也可作为原生桌面应用运行（当前以 macOS DMG 为主要打包路径）。

```bash
npm install
npm run electron:dev            # 开发：本地源码 + Electron
npm run electron:prod           # 生产 standalone 构建后启动 Electron
npm run dist:dmg                # 打包 macOS arm64 DMG
```

桌面端常用环境变量：

| 变量 | 作用 |
| --- | --- |
| `PI_WEB_ELECTRON_PORT` / `PI_WEB_PORT` | 优先使用的本地端口（默认 `30142`） |
| `PI_WEB_NODE_BINARY` | 指定系统 Node 路径，供 `node-pty` 等原生模块使用 |

## 功能介绍

- **会话工作区** — 按项目浏览历史对话；支持重命名、删除、导出 HTML，无需在终端里翻路径。
- **实时 Agent 对话** — 发送消息、SSE 流式输出，查看 tool call/result、thinking、压缩与上下文占用。
- **安全分支** — 从某条消息 Fork 出独立会话，或在同一会话内 Continue / 切换分支，保留原有历史。
- **Git Worktree** — 在侧边栏切换 checkout，让新会话和 Explorer 跟随目标分支。详见 [Worktree 说明](./docs/worktrees.zh-CN.md)。
- **Git 审查面板** — 状态、diff 与跳转打开文件，和对话并排使用。
- **内置终端** — 右侧工作区可开多个基于项目 cwd 的终端（xterm + node-pty）。
- **文件浏览与预览** — 项目树 + 源码 / Markdown / 图片 / 音频 / PDF / DOCX 预览，文件变更可刷新。
- **模型与鉴权** — 在 UI 中管理 `models.json`、OAuth/API key 与模型连通性测试。
- **Skills** — 按运行时加载方式列出、搜索、安装与开关技能。
- **权限模式** — 在输入栏切换 ask / full（YOLO）。
- **中英文界面** — 应用内语言切换，偏好会持久化。
- **主题 / 小地图 / 快捷键** — 明暗主题、聊天 minimap、完成提示音，以及全局快捷键（如 Esc 中止）。

## HTTP 代理

服务端模型请求与 API 请求会读取标准代理环境变量：`HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`。

macOS / Linux：

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
npx @agegr/pi-web@latest
```

Windows PowerShell：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
npx @agegr/pi-web@latest
```

## 注意事项

- **数据目录** — 默认读取 `~/.pi/agent/sessions`。可用 `PI_CODING_AGENT_DIR` 指向其他 pi agent 目录。
- **会话文件** — `~/.pi/agent/sessions/<编码后的工作目录>/<时间戳>_<uuid>.jsonl`。
- **模型配置** — Models 面板读写 pi agent 目录下的 `models.json`，列表与默认模型由 pi 配置解析。
- **文件访问** — 浏览/预览限定在会话 cwd、解析后的项目根、`~/pi-cwd-*` 以及显式允许的根目录。
- **Fork 与会话内分支** — Fork 会新建 `.jsonl`（侧边栏通过 `parentSession` 显示父子关系）；Continue / 分支导航仍在同一文件内。
- **内置包** — 对 Web/桌面有用的一等包（permission、subagents、todo、ask-user、better-compaction 等）会在启动时自动安装到 `~/.pi/agent`。

## 开发

```bash
npm install
npm run dev                     # http://localhost:30141
```

常用检查：

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

常用脚本：

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | Next.js 开发服务，端口 `30141` |
| `npm run build` | 生产构建（仅发布 / Electron 使用） |
| `npm run start` | 启动生产构建 |
| `npm run electron` / `electron:dev` | 启动桌面壳 |
| `npm run build:electron` | 构建并准备 Electron standalone |
| `npm run dist:dmg` | 打包 macOS DMG |
| `npm run release` | 递增 patch 版本、构建并发布 npm 包 |

**本地用 `npm run dev` 迭代时不要执行 `next build` / `npm run build`。** 构建会写入 `.next/`，容易干扰开发服务器；生产构建留给发布或 Electron 打包。

## 项目结构

```text
app/
  api/
    agent/          # 创建/驱动 AgentSession，提供 SSE
    auth/           # OAuth 与 API key
    cwd/            # 工作目录校验
    default-cwd/    # 默认 ~/pi-cwd-* 辅助
    file-index/     # 项目文件索引 / 模糊搜索
    files/          # 列表、读取、预览、watch
    git/            # 审查面板用的 status + diff
    home/           # 用户 home 目录
    models/         # 可用模型、默认模型、thinking levels
    models-config/  # 读写 models.json、测试模型
    permissions/    # ask / full 权限模式
    sessions/       # 列表、重命名、删除、上下文、HTML 导出
    skills/         # 列表、搜索、安装、启停
    worktrees/      # Git worktree 列表/创建/删除
components/
  AppShell.tsx        # 布局、URL 状态、桌面标题栏、工作区标签
  SessionSidebar.tsx  # 项目、会话、worktree、Explorer
  ChatWindow.tsx      # 消息、SSE、拖拽、minimap
  ChatInput.tsx       # 模型 / 工具 / thinking / compact / 权限
  MessageView.tsx     # 用户/助手/工具渲染
  GitPanel.tsx        # Git 状态与审查
  TerminalPanel.tsx   # xterm 终端
  ModelsConfig.tsx    # 模型与鉴权面板
  SkillsConfig.tsx    # 技能面板
  FileExplorer.tsx    # 文件树
  FileViewer.tsx      # 源码 / diff / 媒体 / PDF / DOCX 预览
lib/
  rpc-manager.ts      # AgentSession 生命周期与全局 registry
  session-reader.ts   # .jsonl 解析与分支上下文
  pty-sessions.ts     # node-pty 会话管理
  worktree.ts         # 项目 / worktree 解析
  permission-mode.ts  # ask/full 模式持久化
  http-dispatcher.ts  # 服务端 fetch 的 HTTP(S) 代理
  file-access.ts      # 文件访问白名单
  i18n/               # 中英文文案
  ensure-builtin-packages.ts
hooks/
  useAgentSession.ts      # 加载、发送、SSE、状态对账
  useLocale.ts            # 语言偏好
  useKeyboardShortcuts.ts # 全局快捷键
  useTheme.ts / useAudio.ts / useDragDrop.ts / useIsMobile.ts
electron/                 # 桌面端 main + preload
bin/pi-web.js             # npm CLI 入口
scripts/                  # Electron 打包与 node-pty 修复
instrumentation.ts        # 服务端 HTTP dispatcher 初始化
```

## 相关文档

- [Pi Web 里的 Worktree](./docs/worktrees.zh-CN.md)
- [English README](./README.md)
- 上游智能体：[pi-mono](https://github.com/badlogic/pi-mono)

## 许可证

MIT
