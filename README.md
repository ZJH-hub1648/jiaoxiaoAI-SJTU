# 交小AI 上海交通大学 Canvas 集成

这是一个轻量的集成快照，用于给已有的交小AI/Open WebUI Fork 增加只读 Canvas 学习助手。它不是完整的交小AI源码仓库。

## 已包含

- `sjtu_canvas` Open WebUI Tool：读取当前用户自己的课程、待办和作业。
- `sjtu_canvas` Open WebUI Skill：说明何时调用工具、如何展示结果以及只读安全边界。
- 托管插件同步扩展：从 `deploy/managed/plugins/skills/` 自动导入 Skill，并绑定到 `jiaoxiaoai` 模型。
- 密码输入事件修复：用户工具密码字段离开焦点后会触发自动保存，避免只显示圆点但后端未写入。
- 保存结果校验：工具配置接口不再在实际写入失败时返回虚假成功。
- 可审查源码和生成脚本：`deploy/managed/plugin-src/`、`scripts/build_managed_plugin_bundles.py`。
- 只读客户端测试：分页、跨域跳转、认证失败、HTTPS 和未配置状态。

## 上游关系

本快照基于本地交小AI Fork：

- 上游仓库：`fangyan428/open-webui`
- 分支：`feat/jiaoxiaoai-platform`
- 集成提交基线：`eb78b0fa1`
- 集成提交：`4a4afbeb4`
- 密码保存修复提交：`927b74c8a`
- 保存失败校验提交：`fbf0156f6`

上游许可证和署名文件已保留在本仓库。详见 [UPSTREAM.md](UPSTREAM.md)。

## 应用方式

先把目标 Fork 放到干净分支：

```powershell
git switch -c feat/sjtu-canvas-skill
```

从本仓库目录执行：

```powershell
.\apply-overlay.ps1 -Destination C:\path\to\jiaoxiaoai
```

脚本只覆盖 Canvas 集成涉及的文件，不会删除目标仓库中的其他文件。

## 生成和验证

```powershell
python scripts/build_managed_plugin_bundles.py
python -m unittest backend.tests.test_sjtu_canvas_plugin -v
```

本项目新增的工具使用纯 Python 标准库调用 Canvas 官方 v1 API，网络测试使用模拟响应，不需要真实课程数据。

## 用户配置

部署并同步后，每位用户在“上海交大 Canvas 学习助手”工具设置中填写：

- `canvas_base_url`：默认 `https://oc.sjtu.edu.cn`
- `canvas_api_token`：自己的 Canvas 访问令牌
- `timeout_seconds`：默认 15 秒
- `max_pages`：默认最多 5 页

不要把令牌提交到 Git、写入 JSON 配置或发到聊天中。生产环境应设置稳定的 `WEBUI_SECRET_KEY`，并启用 `ENABLE_VALVE_ENCRYPTION=true`。

## 安全边界

- 只读：没有提交作业、发消息、改分或修改课程设置的能力。
- 只使用 Canvas 官方 v1 API，不抓网页，不读取账号密码或浏览器 Cookie。
- 遇到登录跳转、跨域分页、401/403 或 429 时停止并返回可操作错误。
- 学校管理员可能限制个人令牌或 API 权限；未确认学校政策前，不应把共享令牌部署给全体用户。

## 尚未验证

当前没有使用真实 Canvas 访问令牌，因此尚未验证上海交大租户开启的具体 API 与个人令牌政策。已确认 `https://oc.sjtu.edu.cn/api/v1/users/self/profile` 在未认证时返回 `401`，接口采用 Canvas 标准认证入口。
