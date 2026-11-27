# Paper reading assistance · 可独立部署的论文 Skill

当前版本 **1.7.0-rc.1**。本目录现在是完整、独立的 `paper-reading-assistance` Skill：包含自己的 PDF/OCR/图像依赖、JSON 命令行工具、MCP 服务和可选阅读器。**不再需要父仓库、Canvas、Open WebUI、Python 或额外模型 API Key。**

- 文本/扫描 PDF：导入、分页阅读、搜索、本机中英文 OCR。
- 使用宿主 Agent 当前模型：摘要翻译、来源匹配的注释、带页码问答、多篇对照、框选公式与图表解读。
- 可选阅读器：显示 PDF、页边注释与高亮、保存进度、导出笔记；既可连接宿主 Agent 队列，也可继续使用独立模型服务。
- Linux/云端无桌面环境可只用 CLI 或 MCP，不必启动浏览器。设备需有 Node.js 22.13+ 和本地文件/命令执行能力。

## 安装到另一台设备

**如果还要接入 Canvas：Canvas 课程/作业功能仍必须配置 Canvas API Token。**“无需额外模型 API Key”仅指论文的宿主模型流程，不是免除 Canvas 鉴权。本目录提供共享凭据引导，完整课程功能由原 `sjtu-canvas` 技能提供；可在同一 Agent 中同时安装两个技能。详见 [Canvas 安装与 Token 配置](CANVAS-SETUP.md)。

下载 [独立 Skill ZIP](release/paper-reading-assistance-v1.7.0-rc.1.zip) 和 [SHA-256](release/paper-reading-assistance-v1.7.0-rc.1.zip.sha256)，解压得到 `paper-reading-assistance/`。把该目录放入目标 Agent 支持的技能目录，确保第一层直接是 `SKILL.md`。

在这个技能目录内执行：

```powershell
npm ci --omit=dev
node scripts/paper.mjs status
```

需要 Canvas 时，由用户在本机运行 `node scripts/configure-canvas.mjs setup`，按提示隐藏输入并在线验证；随后运行 `node scripts/configure-canvas.mjs check`。也可在阅读器“模型设置 → 连接 Canvas 学习平台”中完成。论文功能可以跳过这一步。

也可在下载的本目录内运行安装器（不改目标 Agent 的配置文件，不覆盖既有目录）：

```powershell
node scripts/install.mjs --agent codex
node scripts/install.mjs --agent claude
# 自定义 Agent 或项目级技能目录：使用明确的绝对路径
node scripts/install.mjs --target "D:/my-agent/skills/paper-reading-assistance"
```

安装器会返回安装路径和下一步命令。在目标目录执行一次 `npm ci --omit=dev`，再让 Agent 重新发现技能或读取 `SKILL.md`。Codex 默认目录为 `~/.agents/skills/paper-reading-assistance`，Claude Code 为 `~/.claude/skills/paper-reading-assistance`；其他 Agent、项目级路径或自定义目录以实际配置为准。

## 在 Agent 中使用

给 Agent 提供 PDF 的真实本地路径，例如：

> 使用 paper-reading-assistance 读取这篇论文，翻译摘要，在关键方法处写注释，并说明研究局限。PDF 位于……

Agent 按 `SKILL.md` 调用 `import → prepare → 当前模型生成结果 → complete`。程序验证原文引文、来源页码、资料是否变更，再把结果写入本机阅读记录。此过程没有调用另一个模型服务；资料进入宿主 Agent 的当前上下文，仍受该 Agent 和其模型服务的数据规则约束。

支持 MCP 的 Agent 也可连接 `node /技能绝对目录/mcp.mjs`，获得 `paper_import`、`paper_read`、`paper_ocr`、`paper_prepare`、`paper_complete` 等标准工具。完整参数及 CLI 示例见 [部署与工具指南](DEPLOYMENT.md)。

## 可选阅读器

```powershell
node server.mjs --file "C:/path/to/paper.pdf"
# 云端或不自动打开浏览器
node server.mjs --no-open
```

Windows 可双击 `start-reader.cmd`；macOS/Linux 可执行 `sh start-reader.sh`。这些命令从任意工作目录都可运行，路径含空格时请加引号。

阅读器设置中选择“当前宿主 Agent”后，问题进入本机队列，由正在工作的 Agent 调用 `paper_pending / paper_respond` 处理。**不能自动唤醒已经结束的 Agent 会话，也不声称能直接读取宿主的私有模型凭据。**需要独立实时问答时，可选择兼容 API 或 Ollama；只有这一可选模式需要另行配置模型服务。

跨设备运行的云端 Agent 不会自动看到桌面文件或桌面浏览器。无界面工具可直接处理其工作区 PDF；若要桌面阅读器，请在桌面本机安装本 Skill。程序只监听回环地址，不自动开放公网访问。

## 验证、打包与数据

```powershell
npm ci
npm test
npm run test:browser
npm run test:portability
npm run pack
```

`test:portability` 在仓库外解压独立包、安装纯运行依赖、复制到 Agent 技能目录，从无关工作目录执行真实 CLI 和 MCP 客户端，再验证宿主问答桥接。它模拟另一台设备的干净软件环境，不等于已操作所有品牌 Agent 或所有操作系统。

默认数据目录 `~/.config/jiaoxiaoai-paper/`，可用 `PAPER_READER_DATA_DIR` 或工具的 `--data-dir` 指定独立绝对目录。原 PDF、OCR、注释、问答、图像及任务队列均存于该目录。密钥仅用于可选独立模型模式。详见 [隐私与存储](PRIVACY.md)。

第三阶段的 OCR、图表、本地模型功能说明见 [STAGE3.md](STAGE3.md)；该文档的 1.6 安装步骤属于历史记录，当前部署统一以本文件和 [DEPLOYMENT.md](DEPLOYMENT.md) 为准。`release/` 的 1.5、1.6 包也为历史包，独立部署请用 1.7。
