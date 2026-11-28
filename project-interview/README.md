# 基于真实项目的技术面试 Skill

本目录为独立 `project-interview` Skill，版本 **0.6.0-rc.1**，覆盖六阶段功能。使用 Node.js 22.13+，无需 Canvas Token 或额外模型 Key。CLI 无第三方运行依赖；MCP 使用本目录锁定的官方 SDK。可安装到支持 Skill/本机命令或 stdio MCP 的 Agent，不需要父仓库或论文模块。

当前已实现：项目/文本简历读取、带文件哈希和行号的证据索引、正式/学习模式、基于回答的连续追问、会话恢复、三级提示、四维评估、独立作答与辅助学习分开汇总、Markdown/JSON 复盘和练习清单、19 个 MCP 工具、独立安装器与版本化 ZIP。问题与评价由当前宿主 Agent 模型生成，工具验证引用、记录状态并计算汇总；没有独立网页或语音界面，不会在已结束的 Agent 对话中自行运行。

下载 [独立 ZIP](release/project-interview-v0.6.0-rc.1.zip) 和 [SHA-256](release/project-interview-v0.6.0-rc.1.zip.sha256)。解压后运行 `node scripts/install.mjs --agent codex`，或用 `--target "实际绝对技能目录"` 指定目标。安装器拒绝非空目标，不改 Agent 设置。在**目标安装目录**执行 `npm ci --omit=dev` 后可连接 MCP；只用 CLI 可省略安装依赖。完整安装、MCP 配置和跨设备注意事项见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 最直接的用法

在能执行本机命令的 Agent 中加载此 Skill，然后提供：

> 使用 project-interview，基于 `/我的项目绝对路径` 和 `/我的简历.md` 做一场项目技术面试。先读代码，正式模拟模式，每次只问一个问题，等我回答后继续追问。

Windows 可以使用 `C:/projects/demo`。macOS/Linux 使用本机实际绝对路径；云端 Agent 只能访问其工作区，不能自动读取用户桌面文件。简历可省略；目前不直接解析 PDF/DOCX。

## CLI 流程

以下均在本 Skill 目录运行；从其他目录调用时使用脚本绝对路径。私有数据默认 `~/.config/jiaoxiaoai-interview/`，可通过 `PROJECT_INTERVIEW_DATA_DIR` 或每条命令的 `--data-dir "绝对目录"` 改写，不能与项目目录重叠。

```sh
node scripts/interview.mjs help
node scripts/interview.mjs index --project "/实际项目根目录" --resume "/实际简历.md"
node scripts/interview.mjs inspect --snapshot 实际索引UUID --query "cache 数据流"
node scripts/interview.mjs evidence --snapshot 实际索引UUID --evidence 实际证据ID
node scripts/interview.mjs start --snapshot 实际索引UUID --mode simulation --difficulty intermediate --rounds 8
node scripts/interview.mjs prepare --session 实际会话UUID --query "入口与数据流"
```

宿主根据 prepare 的证据和结构生成一个问题，将 JSON 写到仓库外的私有文件。后续运行：

```sh
node scripts/interview.mjs question --session 实际会话UUID --job 实际任务UUID --result-file "/私有目录/question.json"
# 向用户提问并等待；将用户的实际回答写入 answer.txt
node scripts/interview.mjs answer --session 实际会话UUID --answer-file "/私有目录/answer.txt"
node scripts/interview.mjs prepare --session 实际会话UUID
node scripts/interview.mjs show --session 实际会话UUID
node scripts/interview.mjs pause --session 实际会话UUID
node scripts/interview.mjs resume --session 实际会话UUID
node scripts/interview.mjs end --session 实际会话UUID
```

第二轮起提交的问题须包含上一回答的原样 `answerQuote` 及 `rationale`。准备/提交分开，确保模型生成与可验证写入之间有清晰边界。代码改变后重新索引并新建会话，旧会话记录保留。返回 JSON，失败为 `ok:false` 和非零退出码。

## 提示、评价与复盘

学习模式等待回答时，可按用户请求调用 `prepare-hint --session UUID --level 1`，宿主生成内容后通过 `hint --session UUID --job UUID --result-file "/私有目录/hint.json"` 保存，才向用户展示。后续逐级请求 2/3 级；记录过提示的轮次不计入独立作答分数。正式模拟不开放提前提示和评价。

回答后（正式模拟需先结束），逐轮执行：

```sh
node scripts/interview.mjs prepare-review --session 实际会话UUID --round 1
# 宿主依据返回的真实回答、代码和评分量表生成 review.json
node scripts/interview.mjs review --session 实际会话UUID --job 实际任务UUID --result-file "/私有目录/review.json"
node scripts/interview.mjs report --session 实际会话UUID
node scripts/interview.mjs export --session 实际会话UUID --output "/私有目录/report.md"
node scripts/interview.mjs export --session 实际会话UUID --output "/私有目录/report.json"
```

四维为解释准确性、代码理解、取舍分析、故障推理，0–4 分。未考察为 null；未齐四维或还有未评价/未回答轮次时不生成总分。复盘含真实问题/回答、得分理由与回答原文、代码位置/哈希、知识缺口和带验收标准的练习。它用于学习诊断，不预测面试通过率。0.3.0 旧记录仍可读取；旧轮次无提示记录并不证明没有接受过外部帮助。

完整数据结构、限制和验收要求见 [CONTRACT.md](references/CONTRACT.md)。`npm test` 验证索引、状态、评分和导出；先 `npm ci --ignore-scripts`，再 `npm run test:release` 验证 ZIP 解压、仓库外安装、干净依赖及真实 MCP 全流程；`npm run pack` 重建发布包。测试使用固定宿主样本，不调用真实模型，也不衡量真实模型的出题深度。跨平台运行结果见仓库 Actions 的 `Project interview release validation`。

## 数据与边界

索引复制部分源码及简历文本到私有数据目录，面试记录含用户回答；不要将其提交到公开仓库。宿主模型读取证据受其自身的数据规则约束。虽然排除常见凭据路径和密钥模式，过滤仍非完整保密审查；敏感项目请先提供脱敏版本。

静态分析不会执行项目、安装其依赖或断言测试已通过。代码引用与简历词汇映射不等于运行证明或贡献证明；程序无法自动保证模型解释和评分公平。数据边界见 [PRIVACY.md](PRIVACY.md)。
