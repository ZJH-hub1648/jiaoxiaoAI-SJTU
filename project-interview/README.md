# 基于真实项目的技术面试 Skill · 阶段 1–3

本目录为独立 `project-interview` Skill，版本 0.3.0。使用 Node.js 22.13+，无第三方运行依赖，无需 Canvas Token 或额外模型 Key。可以将**整个目录**放到目标 Agent 支持的技能目录，并让它读取 `SKILL.md`。不要只复制该文件；工具依赖同目录的 `lib/`。MCP 服务和自动安装器属于后续阶段。

当前已实现：项目/文本简历读取、带文件哈希和行号的证据索引、依赖与入口画像、简历候选依据、正式/学习模式、基于回答的多轮追问、会话暂停/恢复/结束。问题由当前宿主 Agent 模型生成，工具校验后记录；这是文本面试核心，没有独立网页，也不会在无人运行的会话中自动出题。

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

完整数据结构、限制和验收要求见 [CONTRACT.md](references/CONTRACT.md)。运行本目录 `npm test` 验证索引隔离、真实 CLI、多轮状态、来源校验和恢复；测试不访问模型接口，不衡量真实模型的出题深度。

## 数据与边界

索引复制部分源码及简历文本到私有数据目录，面试记录含用户回答；不要将其提交到公开仓库。宿主模型读取证据受其自身的数据规则约束。虽然排除常见凭据路径和密钥模式，过滤仍非完整保密审查；敏感项目请先提供脱敏版本。

静态分析不会执行项目、安装其依赖或断言测试已通过。代码引用与简历词汇映射不等于运行证明或贡献证明。当前不生成最终评分或复盘报告；这些属于第四阶段。
