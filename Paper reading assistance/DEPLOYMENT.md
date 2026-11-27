# 独立 Skill 部署与 Agent 工具

## 支持条件与安装

Skill 目录第一层包含 `SKILL.md`、`package.json`、锁文件、`scripts/`、`lib/`、`ui/`、`mcp.mjs` 和阅读器入口。只需该目录，不需要父仓库。Node.js 22.13+，标准桌面或服务器操作系统，Agent 能运行本机命令或连接本机 stdio MCP；安装依赖时需要 npm 网络或预置缓存。

解压独立 ZIP 后，将 `paper-reading-assistance` 放入目标 Agent 的技能目录，再在该目录运行 `npm ci --omit=dev`。也可运行 `node scripts/install.mjs --agent codex|claude|dsh|workbuddy`，或 `--target "实际绝对目录"`。默认目录只是预设；用户自定义的 Agent 根目录请用 `--target`。安装器拒绝覆盖非空目录，不自动改 Agent 配置，也不复制依赖、数据、历史 ZIP 或源码仓库。

Codex 用户技能预设：`~/.agents/skills/paper-reading-assistance`；Claude Code：`~/.claude/skills/paper-reading-assistance`。DSH/WorkBuddy 预设分别为 `~/.dsh/skills/`、`~/.workbuddy/skills/`，以目标版本实际发现目录为准。项目级部署可直接用 `--target` 指向项目的技能路径。安装后刷新/重启宿主，或在支持读取技能文件的 Agent 中显式加载 `SKILL.md`。

所有数据路径均指 **Agent 运行设备**。远程 Agent 工作区不能自动读取用户桌面文件；请先通过该宿主的文件功能提供 PDF。

## JSON 命令行

若还需接入 Canvas，必须按 [CANVAS-SETUP.md](CANVAS-SETUP.md) 安装完整主 Canvas 技能，并由用户在本机执行 `node scripts/configure-canvas.mjs setup` 隐藏输入 API Token，再用 `check` 在线检查。本论文 Skill 不要求 Token，但不能因此省略 Canvas 鉴权；该配置文件与主技能共用。

下面命令均在 Skill 目录执行；从其他目录执行时将 `scripts/paper.mjs` 改成绝对路径。可在任一命令尾部加 `--data-dir "私有绝对目录"`，也可以设置 `PAPER_READER_DATA_DIR`。输出为 JSON，错误 `ok=false` 且非零退出，不回显密钥。

```powershell
node scripts/paper.mjs status
node scripts/paper.mjs import --file "C:/papers/paper.pdf"
node scripts/paper.mjs list
node scripts/paper.mjs read --paper 实际ID --page 2 --offset 0 --limit 12000
node scripts/paper.mjs search --paper 实际ID --query "关键词"
node scripts/paper.mjs ocr --paper 实际ID --page 1 --language eng+chi_sim
node scripts/paper.mjs crop --paper 实际ID --page 1 --rect 0.1,0.2,0.5,0.3 --output "C:/private/crop.png"
node scripts/paper.mjs prepare --paper 实际ID --task translate
node scripts/paper.mjs prepare --paper 实际ID --task annotate --page 1
node scripts/paper.mjs prepare --paper 实际ID --task qa --question "研究局限是什么？"
node scripts/paper.mjs prepare --task compare --papers ID1,ID2 --question "比较方法和实验条件"
node scripts/paper.mjs prepare --paper 实际ID --task visual --page 1 --rect 0.1,0.2,0.5,0.3 --kind formula
node scripts/paper.mjs complete --job 实际任务UUID --result-file "C:/private/result.json"
node scripts/paper.mjs export --paper 实际ID --output "C:/private/notes.md"
```

`prepare` 不调用外部模型，只输出相关论文片段、提示、返回结构和真实任务 ID。由当前 Agent 生成结果后调用 `complete`。注释引文必须匹配来源；比较引用必须同时含论文编号和页码。原文改变后旧任务不能写回。JSON 结果文件不要写进技能仓库，检查完成后可在用户允许的临时目录清理。

扫描件由 `ocr` 在本机生成可检索文本和词框，原 PDF 不改动。原生文字页需明确 `--overwrite` 才会被替换。`crop` 返回实际 PNG，不需要桌面浏览器；若宿主模型没有图像能力，应说明限制。输出文件要求绝对路径，默认不覆盖。

## MCP 接入

将以下连接参数加入宿主的 MCP 配置界面/文件，具体配置格式以宿主为准。这是连接参数示例，不表示所有 Agent 使用同一种配置文件：

```json
{
  "command": "node",
  "args": ["/实际技能绝对目录/paper-reading-assistance/mcp.mjs"],
  "env": { "PAPER_READER_DATA_DIR": "/用户私有数据目录" }
}
```

Windows JSON 路径可使用 `C:/...`，或转义反斜杠。stdio 只用于 MCP，不在 stdout 打印普通日志。

| MCP 工具 | 用途 |
| --- | --- |
| `paper_status` / `paper_list` | 就绪状态和论文库 |
| `paper_import` | 原生 PDF 解析，不用浏览器 |
| `paper_read` / `paper_search` | 有界原文和关键词证据 |
| `paper_ocr` / `paper_crop` | 本机识别和区域 PNG |
| `paper_prepare` | 给当前 Agent 提供任务、来源与可选图像 |
| `paper_complete` | 校验并保存 Agent 结果 |
| `paper_pending` / `paper_respond` | 处理阅读器里排队的问题 |
| `paper_export` | 用户请求的 Markdown 导出 |

MCP 和 CLI 共用数据及校验逻辑。宿主生成结果时使用它自己当前的模型，不读取或迁移它的私有模型配置。OCR/图像渲染需要本包对应系统/CPU 的 Canvas 原生依赖，npm 会按平台安装；不支持的平台会在运行时报告依赖错误，不能视为已验收。

## 可选阅读器与宿主问答桥接

`node server.mjs` 启动本机阅读器。切换到“当前宿主 Agent”后无需模型地址/Key；需允许当前 Agent 处理论文内容。问题保存在本机 `jobs/`，Agent 主动调用 `pending --wait 10` 或 `paper_pending` 取得 `reader-request`，用当前模型回答后调用 `respond` / `paper_respond`。图片以本地文件和 MCP image 内容提供，不将图片 base64 放进普通文字提示。

CLI 回答方式：`node scripts/paper.mjs respond --job UUID --result-file "包含answer字段的绝对JSON路径"`。

阅读器等待上限 10 分钟，可取消，不保存取消后的半成品。桥接仅在 Agent 活跃处理时运作；没有通用机制自动唤醒所有产品中的已结束会话。宿主提交完整回答后显示，非逐 token 流。需要独立持续问答时，可继续配置独立 API/Ollama 模型，这是可选的模式。

无桌面/浏览器的云端部署默认只使用工具。若需要侧边阅读器，在同一设备的浏览器打开回环 URL，或在桌面设备另装技能。不会自动开启公网端口。

## 升级、测试和打包

升级时保留私有数据目录，将新 Skill 安装到空目标目录，再安装其依赖；数据无需从源码目录迁移。不要复制其他设备的模型 Key、浏览器会话或个人论文到公开仓库。

```powershell
npm ci
npm test
npm run test:browser
npm run test:portability
npm run pack
```

`test:portability` 执行独立包解压、另一技能目录安装、纯运行依赖安装、任意工作目录下的 CLI/MCP 和宿主问答桥接。测试使用自建论文与宿主回答样本，不衡量真实模型的学术准确性。Windows 的隔离部署可实测；Linux/macOS 不能仅凭路径兼容性标记成已完成真机验收。

本次验收已通过：仓库外独立 ZIP 解压、Agent 技能目录安装、干净 `npm ci --omit=dev`、无关工作目录、无浏览器 PDF 读取与真实 OCR、无需模型 Key 的宿主结果写回、标准 MCP 客户端调用、图片工具返回、独立阅读器资源和阅读器问题桥接。另有原仓库 57 项 Node 回归、本目录 8 项测试、前两阶段/第三阶段浏览器流程及 Canvas 配置页面验证通过。Canvas 页面验证使用模拟官方接口，不包含真实学校账号验收。
