# 安装到其他设备和 Agent

## 运行条件

Node.js 22.13+（建议 24），可选 Git。无 Git 时有界目录遍历并显示警告；Git 项目应提供仓库根目录。Skill 使用宿主当前模型，不读取宿主的模型凭据，不需要额外模型 API Key，也不需要 Canvas Token。安装 MCP 依赖时需要 npm 网络或预置缓存；CLI、索引和会话功能可离线执行，宿主模型是否联网由其自身决定。

支持本机 Windows、macOS、Linux 的 Node 运行时；CI 在 Windows、macOS 15 Intel/Apple Silicon、Ubuntu 24.04 x64/ARM64 上执行行为和独立安装验收。产品级接入仍取决于目标 Agent 是否发现技能目录或支持 stdio MCP；这不表示已操作所有品牌 Agent 的 UI。

## 安装 Skill

1. 从 `release/` 下载 `project-interview-v0.6.0-rc.1.zip` 和同名 `.sha256`。macOS 可用 `shasum -a 256 文件.zip`，Linux 可用 `sha256sum 文件.zip`，PowerShell 可用 `Get-FileHash 文件.zip -Algorithm SHA256` 核对。
2. 解压得到 `project-interview/`，第一层直接包含 `SKILL.md`、`scripts/`、`lib/`、`mcp.mjs` 和包锁。无需下载父仓库。
3. 在解压目录执行以下一种安装命令：

```sh
node scripts/install.mjs --agent codex
node scripts/install.mjs --agent claude
# 或使用目标 Agent 的真实绝对路径；路径含空格时必须加引号
node scripts/install.mjs --target "/实际目录/skills/project-interview"
```

Codex 预设为 `~/.agents/skills/project-interview`，Claude Code 为 `~/.claude/skills/project-interview`；另提供 DSH/WorkBuddy 的 `.dsh/skills`、`.workbuddy/skills` 预设，但应以目标产品实际配置为准，用 `--target` 可覆盖。也可直接将整个解压目录放进技能目录。安装器只复制白名单源码，不复制 node_modules、历史包、面试记录，不自动修改任何 Agent 配置。已有非空目录会被拒绝覆盖。

4. 让 Agent 刷新技能或显式读取安装目录的 `SKILL.md`。在安装目录运行 `node scripts/interview.mjs status` 检查。CLI 无需 npm install。
5. 若使用 MCP，在**返回的安装路径**运行 `npm ci --omit=dev`，随后配置下面连接参数。下载目录内安装依赖不会自动复制到安装目录。

## MCP 连接

将以下连接参数加入宿主支持的 MCP 配置界面或文件。各 Agent 配置外层结构不同，这只是连接参数，并非通用配置文件：

```json
{
  "command": "node",
  "args": ["/实际技能绝对目录/project-interview/mcp.mjs"],
  "env": { "PROJECT_INTERVIEW_DATA_DIR": "/私有目录/interview-data" }
}
```

Windows JSON 使用 `C:/...` 或转义反斜杠。macOS 图形界面启动的 Agent 若无法找到 node，用终端 `node -p process.execPath` 返回的 Node 绝对路径作 command。需要命令行指定数据目录时可在 args 中追加 `--data-dir` 和绝对路径。stdio 只承载 MCP 消息，不能当作网页服务；没有监听公网端口。MCP 使用[官方 TypeScript SDK v1](https://github.com/modelcontextprotocol/typescript-sdk/tree/v1.x) 的标准客户端/服务器协议。

| 工具 | 功能 |
| --- | --- |
| `interview_status` / `interview_list` | 就绪状态、寻找已保存会话 |
| `interview_index` / `interview_inspect` / `interview_evidence` | 项目索引、候选证据、准确源码位置 |
| `interview_start` / `interview_show` | 新建或恢复会话 |
| `interview_prepare` / `interview_question` / `interview_answer` | 当前模型出题、校验问题、记录真实回答 |
| `interview_pause` / `interview_resume` / `interview_end` | 会话控制 |
| `interview_prepare_hint` / `interview_hint` | 学习模式逐级提示并记录辅助 |
| `interview_prepare_review` / `interview_review` | 当前模型按量表评价并保存来源 |
| `interview_report` / `interview_export` | 汇总复盘、导出 Markdown/JSON |

prepare 类工具不自行调用另一个模型；宿主生成结果后交给对应提交工具。不要把 `prepare_review` 结果提交到 question 或 hint。MCP 的 result 为结构化对象，answer 为真实回答文本；CLI 用私有输入文件承载同样内容。错误以 MCP isError 或 CLI 非零退出返回。

## 跨设备、升级与排查

所有绝对路径与 `~` 都属于 **Agent 运行设备**。远程 Agent 不能自动读取桌面项目。请将脱敏项目/简历通过宿主文件功能提供给目标设备。会话绑定项目根目录和文件内容哈希；移到另一设备后建议重新索引并新建会话，不直接修改旧记录中的路径。旧会话仍可作为历史材料复盘。

数据默认在 `~/.config/jiaoxiaoai-interview/`，升级时保留它，将新版装入空目录后重新安装 MCP 依赖；不要跨设备复制 node_modules。CLI 无依赖，MCP 依赖只包含 SDK/Zod 和其依赖，没有 PDF/OCR 原生组件。0.3.0 的 schemaVersion 1 记录可继续读取和评价；没有历史提示记录不能证明独立掌握。

状态错误先 `show`，再按状态回答/恢复/结束。代码改变时重新索引；旧评分基于历史快照而非新代码。进程异常退出若留下 `locks/SESSION_ID`，先确认对应进程已经停止再清理该锁目录，不能在并发写入时删除。出题或评分拒绝时重新 prepare，不绕过来源校验。

导出路径需为用户指定的绝对 `.md` / `.json` 路径，位于项目与技能目录之外；文件已存在会失败，应换新文件名。模型评分仍需人工核对；本工具不预测录用概率。
