# SJTU Canvas Skill

一个独立、只读的 Codex Skill，用标准 Python CLI 调用上海交通大学 Canvas 学习平台的官方 v1 API。它不依赖交小AI、Open WebUI、WorkBuddy 或其他应用的前后端实现，因此可以由任意支持 `SKILL.md` 和命令执行的智能体加载。

运行环境为 Python 3.9 或更高版本，不需要安装第三方 Python 包。

[下载 Windows Word 版安装指南](docs/SJTU_Canvas技能安装指南_Windows版.docx)

支持的信息：

- 当前用户和连接状态
- 进行中的课程
- 待办事项
- 各课程作业与截止时间
- 跨课程近期作业
- 课程公告

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

## 验证

```powershell
python -m unittest discover -s tests -v
```
