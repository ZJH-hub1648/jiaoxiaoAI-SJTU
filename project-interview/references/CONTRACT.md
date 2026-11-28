# 项目面试交互与数据约定

## 输入与范围

- 输入：真实本地项目根目录；可选 UTF-8 `.txt` / `.md` 简历；可选岗位、模式、难度、轮数。
- 输出：可追溯项目画像、简历候选证据、连续追问、提示、四维评价、可恢复会话、Markdown/JSON 复盘。
- 正式模拟 `simulation`：提问后等待，不提前讲答案。边学边练 `learning`：允许按请求给提示，提示不代表独立掌握。
- 首版只静态阅读；不运行项目、不安装其依赖、不访问网络。Git 仅用于读取文件清单与 HEAD。不能从源码独自确定吞吐量、线上故障、测试通过情况或个人贡献。

## 索引模型（schemaVersion 1）

`snapshots/UUID.json` 保存根目录、HEAD（如可用）、时间、扫描方式、覆盖范围、警告、语言扩展名、依赖清单及 Node 依赖声明、入口候选、测试文件、文件哈希、证据块和简历主张。

证据结构：`{id,path,startLine,endLine,sha256,kind,text}`。`kind` 为 implementation/test/documentation。行号是源文件物理行，从 1 开始；CRLF 在片段中归一为 LF。每块最多 40 行、约 6000 字符，不截断超长单行充当完整证据。

简历记录文本来源路径及 SHA-256，各主张保留原行号，implementationCandidates/testCandidates/documentationCandidates 只列出相关词汇候选 ID。状态始终为 `unverified`；宿主读取候选源码后，才能向用户说明语义匹配情况。简历摘要与代码事实分别陈述。

Git 模式采用 `git ls-files --cached --others --exclude-standard`，包含未提交变更，非提交树快照；已跟踪文件遵循 Git 自身的忽略语义。无 Git 时有界遍历，明确警告不解释自定义 ignore。默认排除依赖/构建目录、凭据文件、符号链接、非 UTF-8、疑似密钥内容及超大文件。不能据此保证排除任意业务机密。

上限：400 个已索引文件、单文件 192 KiB、总内容 8 MiB、最多 20000 个目录条目、遍历深度 16。触及上限标记 `coverage.partial`；其他不支持/敏感文件计入 skippedFiles。简历最大 64 KiB，最多 60 个非空主张行。Python/Go/Rust 等清单以原文证据供宿主阅读，首版仅对 package.json 做结构化依赖提取。

## 会话与任务

`sessions/UUID.json` 保存 snapshotId、模式/岗位/难度、1–30 的轮数上限、revision、state、turns。每轮包括问题、类型、引文与代码位置、追问依据、用户回答与时间。`jobs/UUID.json` 绑定会话、revision 和本次允许引用的证据 ID。

状态流：

```text
start → ready → prepare（生成任务，状态不变）
ready → question（校验后提交）→ awaiting-answer
awaiting-answer → answer → ready / ended（轮数达到上限）
ready / awaiting-answer → pause → paused → resume → 原状态
ready / awaiting-answer / paused → end → ended
```

修改会话会增加 revision；旧 prepare 任务随后失效。同一会话并发写入使用锁目录，JSON 使用临时文件原子替换。中断后若遗留锁，仅在确认对应进程不再运行后清理私有数据 `locks/SESSION_ID`；不自动夺取锁。

首题提交结构：

```json
{
  "question": "结合具体代码的问题",
  "kind": "implementation",
  "evidence": [{"id": "本次 prepare 返回的 ID", "quote": "原样摘录的代码片段"}]
}
```

kind 支持 architecture/implementation/tradeoff/failure/testing；每题 1–6 条证据，每条引文至少 12 字符且必须匹配原文，提交时重读文件核对 SHA-256。追问还需 `answerQuote`（上一回答原文，至少 5 字符；原回答不足 5 字符则完整引用）和 `rationale`（追问原因）。程序拒绝完全重复的问题，但语义是否有新意、提问是否与引用相关，需宿主模型判断。引用匹配不会自动证明模型结论正确。

## 验收标准

1. 能识别入口、依赖清单和测试位置；实现证据与说明文档分开；无依据的简历主张不变成事实。
2. 已知忽略文件、常见凭据文件、符号链接、过大文件不进入证据；不执行示例项目的 postinstall 或测试代码。
3. 首题后记录真实回答，再给出基于回答的追问；正式/学习模式明确区分。
4. 暂停/恢复、进程重启后恢复、轮数终止与手动结束正常；错会话、过期任务、伪造引文、源文件变化被拒绝且不产生半写入问题。
5. CLI 从无关工作目录运行，默认不需要额外模型 Key；自动测试使用固定宿主生成样本，只验证协议和行为，不能替代真实用户的面试质量评估。

## 提示、评价与报告（0.6.0-rc.1）

schemaVersion 保持 1，0.3.0 记录缺少新增字段时按没有已记录的提示/评价处理。job 新增 type=question/hint/review；不同类型不能混用。提示和评价提交会增加会话 revision，旧任务随之失效。

学习模式 waiting-answer（实际状态字段 awaiting-answer）可按顺序请求 level 1→2→3 提示，每级只能保存一次。prepare-hint 返回证据，提交 `{hint,evidence:[{id,quote}]}` 后追加 turn.hints，并标记 assisted=true。正式模拟禁止提前提示或评价；学习模式可在回答后评价，正式模拟仅 ended 后允许评价。

prepare-review 接受 round，返回真实回答、历史代码、量表和结果结构。提交结构：

```json
{
  "dimensions": {
    "accuracy": {"score": 3, "reason": "解释基本准确但还缺边界分析", "answerQuote": "本轮真实回答的原文"},
    "codeUnderstanding": {"score": 2, "reason": "识别了入口但未说明后续数据流", "answerQuote": "本轮真实回答的原文"},
    "tradeoffs": {"score": null, "reason": "未考察替代方案", "answerQuote": null},
    "failureReasoning": {"score": null, "reason": "未考察故障诊断", "answerQuote": null}
  },
  "explanation": "依据历史代码说明原理和边界，不能编造运行结果",
  "strengths": ["实际观察到的优点"],
  "gaps": ["回答中表现出的缺口"],
  "exercises": [{"task": "具体练习", "successCriteria": "可检查的完成标准"}],
  "evidence": [{"id": "本任务提供的证据ID", "quote": "原样代码片段至少12字符"}]
}
```

各评分须为 0–4 整数或 null，有分数必须引用本轮回答至少 5 字符（短回答完整引用）。0 表示本轮已考察但错误/无法解释，null 表示未考察或证据不足。量表：1 零散/关键错误，2 基本正确有明显缺口，3 正确且说明边界，4 准确、有验证思路且讨论局限。评估使用冻结快照，不要求当前文件仍存在或相同；新的出题/提示仍校验当前哈希。替换评价需要重新 prepare-review，会覆盖该轮旧评价，报告反映最新已保存评价。

report 只接受 ended 会话，不调用模型、不写回存储。每维取已评轮次得分平均值，总分为四维平均×25、四舍五入到整数；缺少任一维、未评完已回答轮次或有未回答问题时总分为 null。`independentMetrics` 排除有记录提示的轮次，未知的外部帮助无法检测。`complete` 要求至少一项评价、已回答轮次均已评价且无悬而未答问题；missingReviews/unanswered 明确列出轮次。模型补出的总体分不会被采纳。

最终复盘包含逐轮题目、回答、提示、维度理由和引用、讲解、优点/缺口、带成功标准的练习、来源位置/哈希以及覆盖限制。export 输出新的绝对 .md/.json 文件，拒绝项目/Skill 目录和覆盖已有文件。

CLI/MCP 完整安装见 [DEPLOYMENT.md](../DEPLOYMENT.md)。`npm test` 执行行为用例；`npm run test:release` 使用真实标准 MCP 客户端验证 ZIP、逐文件校验、独立目录安装、干净依赖、提示/评分/导出和 CLI/MCP 共享状态。模型输出使用合成样本，只验证协议与可观察行为，不代表真实模型质量基准。
