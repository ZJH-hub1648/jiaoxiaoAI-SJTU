# Paper reading assistance · 论文阅读助手

交小AI校园技能的本地论文阅读模块。第一至第三阶段已实现：PDF 导入与阅读、摘要翻译、流式论文问答、页码引用、页边注释与高亮、选中追问、记录恢复、笔记导出，以及本机中英文 OCR、公式/图表/表格框选解读、Ollama 与兼容本地模型、多篇论文对照。第三阶段完整操作、数据边界和新安装包见 [STAGE3.md](STAGE3.md)。

论文功能独立使用，不需要 Canvas Token 或学校账号。根目录的 `sjtu-canvas` 入口保留；第一至第三阶段的专用技能入口为本目录 [SKILL.md](SKILL.md)，标识 `paper-reading-assistance`，可由支持本地技能入口的智能体加载。两者使用同一阅读器，论文不会被发往 Canvas；运行仍需完整仓库，不能只复制本目录。

第三阶段完整安装包：[paper-reading-assistance-v1.6.0-rc.1.zip](release/paper-reading-assistance-v1.6.0-rc.1.zip)，附 [SHA-256 校验文件](release/paper-reading-assistance-v1.6.0-rc.1.zip.sha256)。压缩包包含整个技能及本模块源码；解压后执行下方两条依赖安装命令。`release/` 中仍保留前两阶段的 1.5 历史包，第三阶段请使用 1.6 包。发行包不递归包含自身。

## 安装与启动

下载**整个仓库或完整发行 ZIP**，不要只下载本文件夹。阅读器复用根目录的依赖和启动工具。

要求 Node.js **22.13+ 或 24+**、npm 和现代 Edge/Chrome/Firefox。Python 不是论文阅读器的必需依赖。

在仓库根目录执行：

```powershell
npm ci
npm --prefix "Paper reading assistance" ci
npm run reader
```

Windows 也可以在安装依赖后双击本文件夹的 `start-reader.cmd`；macOS/Linux 执行 `sh "Paper reading assistance/start-reader.sh"`。

命令启动本机回环服务并打开浏览器。首次启动的地址带临时会话，进入后自动移除地址中的会话参数。结束后在启动终端按 Ctrl+C。

智能体可预先导入用户指定的本机 PDF：

```powershell
npm run reader -- --file "C:/Users/name/Documents/paper.pdf"
# 不自动打开浏览器，返回本地访问地址
npm run reader -- --no-open
# 指定独立的数据存储目录（不建议放入代码仓库）
npm run reader -- --data-dir "C:/Users/name/AppData/Local/PaperReader"
```

macOS/Linux 的 `--file` 和 `--data-dir` 使用实际的本机绝对目录。论文最多 32 MiB / 500 页，提取文本总计最多 300 万字符；加密且需要密码的文件请先在本地解密另存。扫描件使用上方 OCR 工具，公式图表使用区域框选解读，多篇对照从左侧或顶部入口进入。数学 OCR、形式化推导验证与不可见实验数据恢复不在能力范围。

## 连接模型

点击右上角“模型设置”，配置：

| 项目 | 填写方式 |
| --- | --- |
| API 根地址 | 支持 Chat Completions 的服务地址，如 `https://你的服务/v1`；本机模型可用 `http://127.0.0.1:端口/v1` |
| 模型名称 | 服务商或本机服务提供的模型名称 |
| API Key | 服务商密钥；本机不要求鉴权时可以留空；服务地址未变时留空保留既有密钥，换服务地址时不会沿用旧密钥，另有删除密钥选项 |
| 发送授权 | 勾选后才允许向所选服务发送摘要、当前页或问答相关文字片段 |

支持兼容接口的 SSE/JSON 和 Ollama 原生 NDJSON，可检测本地模型列表。视觉模型需单独启用和授权图片发送。不支持需要 OAuth 或其他未适配专有协议的接口；这类服务需提供兼容网关。连接错误不会回显密钥或服务端敏感正文。

密钥通过本机服务保存，浏览器不会收到已保存的密钥值。所有生成均使用用户自行配置的模型，可能产生其服务费用。取消生成会停止当前请求，不将部分回答作为完整记录保存。

## 阅读流程

1. 导入 PDF 或拖放到阅读区；解析在浏览器中完成，PDF 原件和提取文字写入本机库。
2. 自动识别前三页的 `Abstract` / `摘要` 段落。模型已配置并授权时，默认自动翻译摘要并解读打开页；可关闭左下角“导入后自动翻译与解读”。重开已读论文不会重复自动生成。
3. 未准确识别摘要时，选中 PDF 中的摘要，点击“翻译选中摘要”。双栏排版、图表、公式和特殊文字编码可能提取不准确，应核对原文。
4. 点击“解读当前页”生成最多 4 条重点注释。模型引用必须匹配本页原文才保存；不匹配时显示错误，不捏造高亮位置。
5. 点击注释卡片，跳转到原页并高亮。选中文字后可“解释这段”“写注释”，或在“问论文”中输入自己的问题。
6. 回答使用 `[p.N]` 标记来源，下面的页码按钮可点击跳转。页码为 **PDF 文件从 1 开始的物理页码**，不一定等于论文页脚编号。只核验引用页属于检索片段，不声称已自动证明每个模型结论。
7. 翻页和缩放自动保存。重新启动并打开论文，恢复页码、缩放、摘要译文、注释和最近 200 轮已完成问答；“导出笔记”保存 Markdown。

问答采用本地关键词/当前页检索，最多发送 10 个约 1600 字符的原文片段及最近 3 轮的有限语境；它不是整篇穷尽阅读或语义向量检索。找不到依据时应由模型明确说明，并由读者回到原文核验。AI 注释是模型解释，不能视为作者原话。

## 数据存储与删除

默认目录：`~/.config/jiaoxiaoai-paper/`。可通过 `PAPER_READER_DATA_DIR` 或 `--data-dir` 覆盖。

```text
jiaoxiaoai-paper/
  model.json                    模型设置及密钥
  papers/<PDF的SHA-256>/
    source.pdf                  原始 PDF
    paper.json                  提取文字、摘要、译文、注释、问答及阅读位置
```

Unix 尽量使用目录 `0700`、文件 `0600`；Windows 依赖账户目录 ACL。密钥文件不是加密保险库。点击“删除论文与记录”会删除该篇 PDF 和阅读记录；模型密钥在设置中单独删除。Canvas 的 `logout` 不清除论文库或模型密钥。

没有作者服务器和遥测。配置模型前只在本机处理；授权后，相关文字发给用户指定的服务，服务商的处理与保留规则由其条款决定。PDF 本体不会作为模型请求附件上传。使用没有云端转发的本机模型时，请求留在其服务所在设备。

## 验证

```powershell
npm test
npm run test:reader
npm run release
# 将完整安装包直接放到本模块的 release/ 目录
npm run release:paper
# 第三阶段测试与新版安装包（也在本模块目录内）
npm --prefix "Paper reading assistance" test
npm --prefix "Paper reading assistance" run test:browser
npm --prefix "Paper reading assistance" run pack
```

浏览器检查优先用系统 Edge，失败时尝试已安装的 Playwright Chromium；没有浏览器可运行 `npm run install:browser`。浏览器测试使用自建两页 PDF 和模拟模型，不需要密钥，不产生 API 费用；覆盖导入、PDF 画布和文字层、翻译、注释、真实文字选区、高亮、问答页码、重开恢复、取消、导出及手机布局。截图位于 `dist/reader-qa/`，不包含个人论文。

实现与自动测试在 Windows 验证。Linux/macOS 的服务逻辑纳入现有 CI；浏览器、真实论文及不同服务商的实际兼容性仍需分别验收。

## 源码结构

| 路径 | 用途 |
| --- | --- |
| `server.mjs` | CLI 启动、预导入本机 PDF |
| `lib/server.js` | 本地 API、会话、生成和取消 |
| `lib/store.js` | 持久化、原子保存和并发更新 |
| `lib/paper.js` | 摘要识别、检索、原文与页码验证 |
| `lib/model.js` | 模型配置、兼容接口、SSE 解析 |
| `lib/advanced.js` | OCR 保存校验、图式解读、模型检测与多篇对照 |
| `ui/ocr.js` | 本机识别引擎与扫描页文字位置 |
| `ui/advanced.js` | 框选区域、OCR 核对、本地模型设置与对照界面 |
| `ui/` | PDF 阅读、侧边注释与流式问答 |
| `tests/` | 自建 PDF、模拟服务、浏览器验收 |

PDF 渲染使用锁定版本的 Mozilla PDF.js（Apache-2.0），依赖由根 `package-lock.json` 管理。第三阶段 OCR 依赖由本文件夹的 `package-lock.json` 单独锁定。完整发行包包含本文件夹以及技能根目录所需文件，排除运行数据、密钥和所有层级的 `node_modules`。
