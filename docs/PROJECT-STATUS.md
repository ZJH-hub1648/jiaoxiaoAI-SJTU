# 交小AI校园技能：项目进度与检查报告

## 2026-11-27 更新：论文阅读第一、第二阶段

新版本为 `1.5.0-rc.1`。`Paper reading assistance/` 已新增本地 PDF 阅读器，支持摘要翻译、流式问答及 PDF 页码引用、自动解读、手写注释、原文高亮、选中追问、页码与缩放恢复、已完成问答保存、Markdown 导出和取消生成。论文功能无需 Canvas Token，与现有课程/课堂流程共存。

使用 `npm ci` 安装依赖，`npm run reader` 启动，在本机“模型设置”配置兼容模型。Node 最低版本更新为 22.13。数据默认留在仓库外 `~/.config/jiaoxiaoai-paper/`；模型调用需用户在界面授权，切换服务不会沿用旧服务密钥。完整说明见 [论文模块指南](../Paper%20reading%20assistance/README.md)。

浏览器端到端验证使用自建 PDF 与模拟模型，覆盖实际 PDF 文字层、选区、高亮、翻译、注释、带引用问答、恢复、取消、导出和移动布局。没有使用私人论文或真实模型密钥；真实服务商兼容性、复杂排版和 Linux/macOS 浏览器仍需分别验收。本阶段不含扫描 OCR、图片/公式理解、多论文检索或系统密钥库。

新增接口与数据处理回归测试，以及独立 `npm run test:reader`。CI 增加 Linux 浏览器工作流，原有六组合测试保留；远端工作流结果以 GitHub 实际运行结果为准。下面保留 2026-11-26 的检查基线与修复记录。

本地最终结果：Python 19/19、Node 57/57，共 76 项测试通过；真实浏览器流程测试、Skill 格式校验通过。浏览器使用系统 Edge，模型使用隔离模拟服务。源码与完整发行 ZIP 将一起放入 GitHub 的 `Paper reading assistance/`；打包脚本排除模型配置、论文库、缓存与归档自身。

检查日期：2026-11-26（Asia/Shanghai）。

## 检查范围与结论

本次核对仓库为 [ZJH-hub1648/jiaoxiaoAI-SJTU](https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU)，不是本地另一个基于 Open WebUI 的旧项目。已执行 `git fetch origin`，检查基线为 `main` / `origin/main` 的 `979232f`（图形安装向导），包版本为 `1.4.0-rc.1`。本报告和配套修复基于该提交。

项目已形成可独立安装的 Agent Skill：一个根技能 `sjtu-canvas`，Python 基础查询与 Node 高级模块共用凭据，不依赖交小AI网页、Open WebUI 或 DSH 插件。当前阶段是候选发布版：主要代码、安装器、测试和打包流程已具备，尚不能认定为完成三平台真实账号验收的稳定版。

检查覆盖技能入口、Python/Node 命令、认证与文件处理模块、课堂模块、安装器服务与页面、发行脚本、CI、测试及相关说明。Word 指南作为既有附件保留，本次不更新其排版或内容；安装与配置以 Markdown 文档为准。

## 已有功能

| 模块 | 已实现能力 | 入口与边界 |
| --- | --- | --- |
| 基础连接 | 验证 Token，读取当前用户资料 | Python `status` |
| 学习安排 | 当前课程、待办、课程作业、公告、跨课程近期截止时间 | Python `courses`、`todo`、`assignments`、`announcements`、`upcoming`；截止时间转换为上海时间 |
| Canvas 课件 | 课程/文件关键词筛选，默认只列 PPT/PPTX，指定文件或整课 PPT 下载 | Node `canvas`；使用真实 ID，保存到用户指定绝对目录，不覆盖已有文件 |
| 课堂资料 | 当前学期课堂课程、录像列表 | Node `classroom courses/videos`；课堂 ID 与 Canvas ID 不可混用 |
| 文稿阅读 | 按时间读取重叠段落，提供段落与字符续读信息 | `classroom read`；默认 5 分钟，最多 15 分钟；字符预算 6000，参数上限 12000，超长段落拆分续读 |
| 文稿搜索 | 单录像内大小写不敏感的关键词匹配 | `classroom search`；默认 20 段，最多 50 段/页；不支持跨录像批量搜索 |
| 本地导出 | 整节文稿导出为带时间戳的 TXT | `classroom download`；明确区分成功、暂无文稿和失败 |
| 安装与配置 | 图形向导、隐藏输入的命令行 setup、状态检查与 logout | 向导验证后保存凭据；可选安装 npm 依赖；旧版更新有相邻备份 |
| 发行 | 三平台 CI 配置、版本 ZIP 和 SHA-256、标签触发 GitHub 预发行 | `.github/workflows/ci.yml`；配置存在不等于本次新修复已在远端通过 CI |

学校数据操作限于读取，不提交作业、改成绩、发送消息或修改课程。课堂登录优先使用 Canvas 官方入口，失败时由用户在独立浏览器窗口完成 jAccount 登录。录像能力指列表与语音文稿，不包含录像视频文件下载，也不包含自行语音转写。

搜索和阅读返回的文稿正文会进入智能体会话，可能由所选模型服务处理；本地下载和导出命令只输出状态、元数据与路径。详情见 [隐私说明](../PRIVACY.md)。

## 可配置内容

### 凭据来源

Python 与 Node 按以下顺序读取，优先来源一旦被指定但不可读，不会静默换用低优先级凭据：

1. 命令参数 `--token-file PATH`。
2. 环境变量 `SJTU_CANVAS_TOKEN_FILE`。
3. `SJTU_CANVAS_TOKEN`。
4. `CANVAS_API_TOKEN`。
5. `CANVAS_ACCESS_TOKEN`。
6. 默认文件 `~/.config/sjtu-canvas/token`。
7. 旧配置 `~/.jiaoxiaoai/config.json` 的 `canvasToken`；可用 `JIAOXIAOAI_CONFIG` 指向兼容配置文件。

不应在聊天或命令行参数中粘贴 Token。新用户优先使用图形向导或交互式 `setup`；新配置写入统一 Token 文件，不另建旧 JSON。环境变量中的 Token 优先于默认文件，可能使刚保存的默认 Token 暂时不被采用；最终验证应检查 `credentialSource`。

### 运行与任务参数

| 配置 | 适用范围 | 默认 / 说明 |
| --- | --- | --- |
| `--base-url`、`SJTU_CANVAS_BASE_URL`、`CANVAS_BASE_URL` | 仅 Python | 按顺序覆盖，默认 `https://oc.sjtu.edu.cn`；使用学校认可的地址；本地回环 HTTP 仅用于测试 |
| `--timeout` | Python | 默认 20 秒，范围 3–60 秒 |
| `--max-pages` | Python | 默认 20 页，范围 1–50；课程与单课列表最多返回 100 条，跨课程近期作业最终最多 500 条 |
| `--limit`、`--days`、`--upcoming`、`--pretty` | Python | 分别控制返回数量、近期窗口、作业筛选和 JSON 格式；`upcoming` 默认 30 天，仅汇总窗口内有截止日期的作业 |
| `CHROME_PATH` | Node 课堂模块 | 指定 Chrome 可执行文件；未设置时优先系统 Chrome，然后尝试 Playwright Chromium；旧配置 `chromePath` 为回退 |
| `--query`、`--history`、`--all` | Node 查询 | 关键词、历史课程、包含非 PPT 文件；具体支持情况以命令帮助为准 |
| `--files` / `--all-ppt`、`--videos`、`--directory` | Node 下载 | 指定真实资源 ID 和本机绝对目录；PPT 两种选择模式互斥 |
| `--start`、`--end`、`--offset`、`--char-offset`、`--max-chars` | Node 文稿阅读 | 秒数区间、段落与段内字符续读、字符预算 |
| `--query`、`--offset`、`--limit` | Node 文稿搜索 | 必填非空关键词，分页大小 1–50 |
| `--confirm-token-file` | Node logout | 删除显式指定或环境变量指定的共享 Token 文件时要求此参数 |
| 安装目标目录 | 图形向导 | Codex、DSH、WorkBuddy 预设位置或自定义绝对目录；预设不自动读取 `DSH_HOME`，已自定义 DSH 根目录时应选自定义安装 |
| `JIAOXIAOAI_INSTALLER_NO_OPEN=1` | 安装器 | 不自动打开浏览器，通过终端输出地址访问 |

Node 的 Canvas 与课堂服务地址固定为交大官方域名，不读取 Python 的地址或超时配置。课堂搜索的 `offset` 与阅读的 `offset` 不是通用游标，必须用于原录像和原查询/时间区间。

## 安装指南

### 图形安装（推荐）

1. 从仓库下载 ZIP 并解压，或执行：

   ```powershell
   git clone https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU.git sjtu-canvas
   cd sjtu-canvas
   ```

2. 安装 Python 3.9+。使用向导和高级功能时另需 Node.js 22+；只手动使用 Python 基础查询时不需要 Node 或第三方 Python 包。
3. Windows 双击 `start-installer.cmd`；macOS/Linux 执行 `sh start-installer.sh`。也可以运行 `npm run installer`，启动向导本身无需先运行 `npm ci`。
4. 选择目标平台与目录；在 Canvas 个人设置生成专用访问令牌，只粘贴到本机向导密码框，验证后保存。
5. 需要 PPT 和课堂文稿时安装可选组件；暂无需要可跳过。
6. 确认课程读取成功，点击“关闭向导”。若直接关闭标签页，还需在终端按 Ctrl+C 结束本地服务。返回目标智能体刷新技能或重启。

| 平台 | 向导预设用户目录（`~` 为当前运行环境用户目录） |
| --- | --- |
| Codex | `~/.agents/skills/sjtu-canvas` |
| DeepSeek Harness | `~/.dsh/skills/sjtu-canvas` |
| WorkBuddy | `~/.workbuddy/skills/sjtu-canvas` |

这些是本项目安装器的预设路径；目标应用版本或自定义配置可能采用其他位置。也可以安装到项目技能目录或应用支持的导入位置，确保根目录直接包含 `SKILL.md`。云端智能体无法自动读取桌面本机 Token，应使用其私有密钥功能配置。

### 手动安装与验证

将整个技能复制或克隆到目标技能目录。在该目录中执行：

```powershell
# 高级功能所需；只用 Python 查询可省略 npm ci
npm ci
# 由用户本人在交互式终端隐藏输入 Token
node scripts/jiaoxiaoai.mjs setup
python scripts/sjtu_canvas.py status --pretty
python scripts/sjtu_canvas.py upcoming --days 14 --pretty
node scripts/jiaoxiaoai.mjs status --check
```

macOS/Linux 将 `python` 改为 `python3`。没有 Chrome 时执行 `npm run install:browser` 安装备用 Chromium。仅使用 Python 时，可以直接在本机私有文件 `~/.config/sjtu-canvas/token` 保存 Token 一行，然后运行 Python 命令，无需 Node setup。

在 Codex 聊天中输入 `$sjtu-canvas 查看我未来14天的作业`，或在其他兼容智能体中选择技能后描述任务。详细步骤和排错见 [INSTALL.md](../INSTALL.md)。

## 本次代码完善

| 发现的问题 | 修复 |
| --- | --- |
| Python 与文档、Node 的旧配置兼容行为不一致 | 增加旧 `canvasToken` 回退，库级读取也识别 `SJTU_CANVAS_TOKEN_FILE`，保留来源优先级 |
| 非 UTF-8 Token 文件产生未处理异常 | 转换为配置错误，不回显文件正文 |
| 安装向导仅检查 Python 命令是否存在 | 按实际版本判断 3.9+，去掉服务端重复探测 |
| 预建空目录无法安装；源码上级目录未被拒绝 | 允许空目录，解析真实路径及现有父路径，拒绝源码父子目录重叠 |
| Token 表单按回车时使用容器构建 FormData | 改用实际表单，并防止回车重复提交；补事件级测试 |
| Python 测试后缓存会进入 ZIP 和安装复制 | 排除 `__pycache__`、`.pytest_cache`、`.pyc/.pyo/.pyd` |
| 浏览器登录轮询的取消信号传错参数位置 | 按 Node timers API 将 signal 放在第三个参数 |
| 安装器关闭说明、配置适用范围与校验示例不准确 | 更新 Markdown、Skill；校验 ZIP 时先进入校验文件所在目录 |
| 非法阅读参数要等到读取凭据/登录后才报错 | 统一参数校验，在读取凭据或启动浏览器前拒绝非法时间、分页和预算 |
| 单个超长段落超过字符预算 | 增加 `nextCharOffset` / `--char-offset`，在预算内分页，重复时间戳并完整保留正文和 Unicode 字符 |
| 同名文件并发保存产生冲突失败 | 以临时文件和原子独占提交保存，冲突时重新编号；不覆盖原文件，失败时清理临时文件 |
| 依赖安装时可切换目标或重复启动，旧任务状态可能误用于新目标 | 服务端锁定安装操作，运行期间返回 409；界面禁用导航，换目标后重置旧任务状态 |

## 验证结果与剩余工作

本次在 Windows 运行：Python **19/19**、Node **51/51** 测试通过。基线分别为 15 和 41 项，共新增 14 项测试，并在原有发行测试中加入缓存排除断言。后续修复覆盖了超长段落无丢字续读、登录前校验、12 路混合文本/流下载同名并发、下载失败清理与安装目标锁定。Node 表单测试为隔离事件测试，不替代真实浏览器安装验收。未使用私人 Token 或读取真实课程资料进行本次验证。

仓库原有 [跨平台记录](PLATFORM-SUPPORT.md) 记载：2026-11-21 六个系统/Python 组合通过 CI，2026-11-22 Windows 安装器真实课程读取通过。这属于历史证据，本次没有重新验证远端 CI 或再次执行真实账号验收；新增修复还需在 CI 和目标系统复验。

Skill 官方 `quick_validate.py` 已通过，输出 `Skill is valid!`。PyYAML 安装在仓库外独立检查目录，未增加产品运行依赖。发行 ZIP 完整性、SHA-256 和缓存排除检查通过。

后续优先级：

1. 用真实账号验收 PPT 可打开、重复下载不覆盖、课堂自动/手动登录、已知关键词搜索、时间补读和 TXT 导出，并记录暂无文稿/无权限/登录失效等状态。
2. 在 Linux/macOS 实机检查安装向导与浏览器，并完成三平台真实账号端到端验收。
3. 新修复通过六组合 CI 后再发布新版本；同步 Word 安装指南与支持矩阵。
报告初次检查提出的四项代码问题（阅读参数提前校验、超长段落预算、同名并发保存、依赖安装目标切换）均已修复并加入回归测试。剩余工作主要为真实账号/目标系统验收、远端 CI 与发布、Word 指南同步。

目前不包含跨录像全文搜索、后台定时提醒、视频文件下载、成绩分析或课程写入功能。系统钥匙串未接入，Token 是本机私有文件；Windows 保护取决于 ACL，不能将 Unix `0600` 描述成加密存储。
