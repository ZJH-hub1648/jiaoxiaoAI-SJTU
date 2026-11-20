# SJTU Canvas Skill

一个独立、对学校平台只读的 Agent Skill。默认使用标准 Python CLI 调用上海交通大学 Canvas 官方 v1 API，并包含可选的 Node.js 模块以下载 PPT、读取和导出课堂语音文稿。它不依赖交小AI、Open WebUI、WorkBuddy 或其他应用的前后端实现，因此可以由任意支持 `SKILL.md` 和命令执行的智能体加载。

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
- 课堂课程、录像与语音文稿读取 / TXT 导出（Node 模块）

主仓库与 PPT 下载、课堂文稿原型的整合目标和验收标准见 [交小AI校园技能整合需求文档](docs/REQUIREMENTS.md)。该文档描述后续目标，不代表相关能力已经迁入主仓库。

只执行 `GET` 请求。提交作业、修改成绩、发送消息和更改课程设置均不在能力范围内。

完整安装步骤见 [INSTALL.md](INSTALL.md)，其中包含 Codex、DeepSeek Harness 和 WorkBuddy 的通俗操作说明。

## 使用

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

先在技能根目录执行 `npm ci`。高级 Node 模块目前使用 `CANVAS_ACCESS_TOKEN` 或 `~/.jiaoxiaoai/config.json`，由用户本人在交互式终端运行 `node scripts/jiaoxiaoai.mjs setup` 完成隐藏输入和验证。它与 Python 默认 Token 文件的统一加载尚未完成，具体边界见需求文档。

```powershell
node scripts/jiaoxiaoai.mjs status --check
node scripts/jiaoxiaoai.mjs canvas courses --query "课程关键词"
node scripts/jiaoxiaoai.mjs canvas files --course 课程ID --query "文件关键词"
node scripts/jiaoxiaoai.mjs canvas download --course 课程ID --files 文件ID --directory "本机绝对目录"
node scripts/jiaoxiaoai.mjs classroom courses --query "课程关键词"
node scripts/jiaoxiaoai.mjs classroom videos --course 课程ID
node scripts/jiaoxiaoai.mjs classroom read --video 录像ID --start 0 --end 300
node scripts/jiaoxiaoai.mjs classroom download --course 课程ID --videos 录像ID --directory "本机绝对目录"
```

文稿关键词检索尚未实现，需求与检索编排已写入文档。隐私和模型数据边界见 [PRIVACY.md](PRIVACY.md)。

## 验证

```powershell
python -m unittest discover -s tests -v
npm ci
npm test
```
