# macOS 与 Linux 部署验收

独立论文 Skill 可以在以下 macOS/Linux 环境部署。2026-11-28 已在 GitHub 托管的对应系统与 CPU runner 中完成实际验收，并非仅在 Windows 上检查路径。

| 系统 | CPU | Node.js | 结果 |
| --- | --- | --- | --- |
| macOS 15 | Intel x64 | 22 | 通过 |
| macOS 15 | Apple Silicon ARM64 | 24 | 通过 |
| Ubuntu 24.04 | x64 | 22 | 通过 |
| Ubuntu 24.04 | ARM64 | 24 | 通过 |

[四平台验收记录](https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU/actions/runs/46032921993)，对应提交 `7e5f6a780325c19934478f5291c1f88d915eeaa4`。工作流 `.github/workflows/paper-skill-platforms.yml` 会在本目录发生修改后重新执行。

每组均执行本目录单元测试，以及独立 ZIP 解压、安装到另一 Agent 技能目录、仅安装运行依赖、从无关工作目录调用 CLI、无界面 PDF 解析与真实 OCR、标准 MCP 客户端、区域图片返回、宿主结果保存、阅读器 HTTP 资源和问答队列桥接。测试中的宿主回答使用固定样本，不代表对真实模型回答准确性的评估。Canvas 配置使用模拟接口，不代表真实学校账号验收。

## 安装步骤

先安装 Node.js 22.13+（建议 Node.js 24），确保终端中的 `node` 和 `npm` 可用。下载本目录 `release/` 的 1.7.0-rc.1 独立 ZIP，解压后在终端执行：

```sh
cd "/实际下载目录/paper-reading-assistance"
# 安装到目标 Agent；已有非空目录会被拒绝覆盖
node scripts/install.mjs --target "$HOME/.agents/skills/paper-reading-assistance"
cd "$HOME/.agents/skills/paper-reading-assistance"
npm ci --omit=dev
node scripts/paper.mjs status
```

上述目标目录适用于采用该目录的 Codex 安装；其他 Agent 请替换为其实际技能目录，例如 Claude Code 的 `$HOME/.claude/skills/paper-reading-assistance`。也可以直接将解压目录放入技能目录，再在该目录安装依赖。无需先在下载目录安装依赖才能运行安装器。

让 Agent 重新发现 `SKILL.md`；需要 MCP 时，配置 `node` 与 `mcp.mjs` 的绝对路径，见 [DEPLOYMENT.md](DEPLOYMENT.md)。GUI 中启动的 Agent 若找不到 `node`，请在 MCP 配置中使用本机 Node 可执行文件的绝对路径。

```sh
# 桌面阅读器，可选；使用 sh 不依赖解压工具是否保留可执行权限
sh start-reader.sh
# 不自动打开浏览器
node server.mjs --no-open
# Canvas 功能另外需要完整 sjtu-canvas Skill 和 API Token
node scripts/configure-canvas.mjs setup
node scripts/configure-canvas.mjs check
```

安装依赖时需要网络或预置 npm 缓存。不要使用 `--omit=optional`：PDF/OCR 的 Canvas 原生组件按系统和 CPU 作为可选依赖安装。更换系统或 CPU 后应重新执行 `npm ci --omit=dev`，不能复制其他设备的 `node_modules`。

## 验证范围与限制

- 无桌面 Linux 服务器可直接使用 CLI/MCP，不需要 X11、浏览器或 Python。侧边注释阅读器需要浏览器；上述四组测试验证了其 HTTP 资源和问答桥接，未执行各系统桌面浏览器的图形交互验收。
- macOS 使用系统 `open` 打开阅读器；有桌面的 Linux 使用 `xdg-open`。无该命令时使用 `--no-open`，自行打开终端显示的回环 URL。远程服务器默认不向公网暴露阅读器。
- 已验证的 Linux 发行版为 Ubuntu 24.04；其他发行版、Alpine/musl、旧版 macOS 和其他 CPU 尚未实测，不能将此表扩大为所有系统版本均已通过。
- 宿主 Agent 需支持本地命令或 stdio MCP。宿主模型问答需 Agent 持续处理队列；不会自动唤醒已结束会话。独立 API/Ollama 模式仍可选配。
- Canvas API Token 与模型 API Key 用途不同。接入学校 Canvas 必须按 [CANVAS-SETUP.md](CANVAS-SETUP.md) 配置 Token；纯论文功能可跳过。
