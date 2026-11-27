# SJTU Canvas Skill

**新增项目技术面试（阶段 1–3）**：读取真实项目与文本简历、建立代码证据索引、由宿主 Agent 当前模型进行连续追问，支持暂停与恢复。独立源码与使用说明见 [`project-interview`](project-interview/README.md)，无额外运行依赖，不需要 Canvas Token；评分与最终复盘属于下一阶段。

当前能力、配置项、安装路径、验证证据与待完成事项见 [项目进度与检查报告（2026-11-26）](docs/PROJECT-STATUS.md)。

**新增论文阅读助手（第一、第二阶段）**：本地 PDF 阅读、摘要翻译、页边注释与原文高亮、选中追问、带页码引用的实时问答、阅读记录恢复及笔记导出。源码集中在 [`Paper reading assistance`](Paper%20reading%20assistance/README.md)，不需要 Canvas Token。

```powershell
npm ci
npm run reader
```

论文模块要求 Node.js 22.13+；在阅读器右上角“模型设置”配置自己的兼容模型服务。完整操作、数据发送范围和测试说明见 [论文阅读指南](Paper%20reading%20assistance/README.md)。

一个独立、对学校平台只读的 Agent Skill。默认使用标准 Python CLI 调用上海交通大学 Canvas 官方 v1 API，并包含可选的 Node.js 模块以下载 PPT、读取和导出课堂语音文稿。它不依赖交小AI、Open WebUI、WorkBuddy 或其他应用的前后端实现，因此可以由任意支持 `SKILL.md` 和命令执行的智能体加载。

仓库现在包含独立的图形安装向导，会检查运行环境、识别 Codex / DSH / WorkBuddy 安装目录、分步指导 Canvas Token 获取、在线验证、保存凭据，并确认真实课程读取。Windows 用户双击 `start-installer.cmd`，其他系统运行 `npm run installer`。

基础查询运行环境为 Python 3.9 或更高版本，不需要安装第三方 Python 包。PPT 与课堂功能需要 Node.js 22+，并在技能根目录运行一次 `npm ci`；课堂登录使用系统 Chrome，没有 Chrome 时可运行 `npm run install:browser`。

[下载 Windows Word 版安装指南](docs/SJTU_Canvas技能安装指南_Windows版.docx)

支持的信息：

- 当前用户和连接状态
- 进行中的课程
- 待办事项
- 各课程作业与截止时间
- 跨课程近期作业
- 课程公告
- Canvas PPT/PPTX 筛选与下载（Node 模块）
- 课堂课程、录像与语音文稿读取 / 关键词搜索 / TXT 导出（Node 模块）
- 三平台自动测试、版本化发行 ZIP 与 SHA-256 校验

主仓库与 PPT 下载、课堂文稿原型的整合目标和验收标准见 [交小AI校园技能整合需求文档](docs/REQUIREMENTS.md)。该文档描述后续目标，不代表相关能力已经迁入主仓库。

只执行 `GET` 请求。提交作业、修改成绩、发送消息和更改课程设置均不在能力范围内。

完整安装步骤见 [INSTALL.md](INSTALL.md)，其中包含 Codex、DeepSeek Harness 和 WorkBuddy 的通俗操作说明。

## 使用

推荐先双击 `start-installer.cmd` 使用图形向导完成安装和连接。

在 Canvas 的账户设置中创建个人访问令牌，保存到本机默认令牌文件：

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\sjtu-canvas" | Out-Null
notepad "$HOME\.config\sjtu-canvas\token"
```

把令牌粘贴进去并保存。然后运行：

```powershell
python scripts/sjtu_canvas.py status
python scripts/sjtu_canvas.py courses
python scripts/sjtu_canvas.py upcoming --days 14
```

也可以显式指定其他本机私有文件：

```powershell
python scripts/sjtu_canvas.py courses --token-file C:\path\to\canvas-token.txt
```

默认平台地址是 `https://oc.sjtu.edu.cn`。如学校更换官方 Canvas 地址，可使用 `--base-url` 指定，但脚本仅允许 HTTPS、同源分页和 `/api/v1/` 路径。

## 安装到其他智能体

整个仓库就是一个技能目录。将仓库复制或链接到目标平台的技能目录即可；核心入口始终是根目录的 `SKILL.md`，可执行逻辑位于 `scripts/sjtu_canvas.py`。各平台的具体路径和调用方式见 [INSTALL.md](INSTALL.md)。

## 可选 PPT 与课堂功能

先在技能根目录执行 `npm ci`。高级 Node 模块与 Python 基础查询共用同一套 Token 来源和默认文件 `~/.config/sjtu-canvas/token`。如果没有令牌，由用户本人在交互式终端运行 `node scripts/jiaoxiaoai.mjs setup`，验证成功后才会保存。旧版 `~/.jiaoxiaoai/config.json` 只作为兼容回退。

```powershell
node scripts/jiaoxiaoai.mjs status --check
node scripts/jiaoxiaoai.mjs canvas courses --query "课程关键词"
node scripts/jiaoxiaoai.mjs canvas files --course 课程ID --query "文件关键词"
node scripts/jiaoxiaoai.mjs canvas download --course 课程ID --files 文件ID --directory "本机绝对目录"
node scripts/jiaoxiaoai.mjs classroom courses --query "课程关键词"
node scripts/jiaoxiaoai.mjs classroom videos --course 课程ID
node scripts/jiaoxiaoai.mjs classroom read --video 录像ID --start 0 --end 300
node scripts/jiaoxiaoai.mjs classroom search --video 录像ID --query "关键词"
node scripts/jiaoxiaoai.mjs classroom download --course 课程ID --videos 录像ID --directory "本机绝对目录"
```

单录像搜索默认每页返回 20 个命中段落，最多 50 个；`total` 是命中段落数，不返回整篇文稿。需要上下文时根据命中的起止秒数调用按时间读取。暂无文稿与“识别文稿未命中”是两个不同状态。隐私和模型数据边界见 [PRIVACY.md](PRIVACY.md)。

统一 Token 的读取优先级为：显式 `--token-file`、`SJTU_CANVAS_TOKEN_FILE`、`SJTU_CANVAS_TOKEN`、`CANVAS_API_TOKEN`、`CANVAS_ACCESS_TOKEN`、默认文件、旧版兼容配置。`logout` 会清除默认技能 Token 和兼容配置；自定义或共享 Token 文件需要显式添加 `--confirm-token-file`。

## 验证

```powershell
python -m unittest discover -s tests -v
npm ci
npm test
npm run release
```

Windows、Linux、macOS 的自动测试状态、真实账号验收边界与发行包位置见 [跨平台支持矩阵](docs/PLATFORM-SUPPORT.md)。在真实账号验收完成前，高级课堂功能不会被宣传为全平台“已支持”。
