# 前三阶段交互与数据约定

## 输入与范围

- 输入：真实本地项目根目录；可选 UTF-8 `.txt` / `.md` 简历；可选岗位、模式、难度、轮数。
- 输出：可追溯项目画像、简历主张的候选证据映射、逐轮问题与追问、可恢复的原始会话记录。
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

kind 支持 architecture/implementation/tradeoff/failure/testing；每题 1–6 条证据，每条引文至少 12 字符且必须匹配原文，提交时重读文件核对 SHA-256。追问还需 `answerQuote`（上一回答原文，至少 5 字符）和 `rationale`（追问原因）。程序拒绝完全重复的问题，但语义是否有新意、提问是否与引用相关，需宿主模型判断。引用匹配不会自动证明模型结论正确。

## 验收标准

1. 能识别入口、依赖清单和测试位置；实现证据与说明文档分开；无依据的简历主张不变成事实。
2. 已知忽略文件、常见凭据文件、符号链接、过大文件不进入证据；不执行示例项目的 postinstall 或测试代码。
3. 首题后记录真实回答，再给出基于回答的追问；正式/学习模式明确区分。
4. 暂停/恢复、进程重启后恢复、轮数终止与手动结束正常；错会话、过期任务、伪造引文、源文件变化被拒绝且不产生半写入问题。
5. CLI 从无关工作目录运行，默认不需要额外模型 Key；自动测试使用固定宿主生成样本，只验证协议和行为，不能替代真实用户的面试质量评估。

第四阶段的评分、教学评估与最终复盘，以及第五阶段 MCP/安装器、第六阶段正式发行包，不包含在当前版本。
