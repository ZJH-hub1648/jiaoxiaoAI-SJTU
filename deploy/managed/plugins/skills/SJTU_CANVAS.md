# 上海交大 Canvas 学习助手

该技能配合 `sjtu_canvas` 工具读取当前用户自己的 Canvas 课程、待办和作业。所有操作均为只读，不包含提交作业、发消息或修改课程设置的能力。

## 配置

1. 在“上海交大 Canvas 学习助手”工具设置中填写平台根地址，默认 `https://oc.sjtu.edu.cn`。
2. 填写当前用户自己的 Canvas 访问令牌，不要把令牌发到聊天中。
3. 确认部署已设置稳定的 `WEBUI_SECRET_KEY`，并启用 `ENABLE_VALVE_ENCRYPTION=true`。

学校管理员可能限制个人令牌或 API 权限；应以学校实际开放的政策为准。平台要求 SSO 跳转时，工具会停止请求，不会把令牌转发给登录页。

## 可执行查询

- `canvas_status`：检查连接和当前用户身份。
- `list_canvas_courses`：列出当前用户正在参与的课程。
- `get_canvas_todo`：列出近期待办和截止任务。
- `list_canvas_assignments`：按课程 ID 读取作业。

工具只接受 Canvas 官方 v1 API，不抓取网页，不读取账号密码或浏览器 Cookie。模型输出仍会交给当前配置的 Provider 处理。

## 发布

从仓库根目录重新生成托管文件：

```bash
python scripts/build_managed_plugin_bundles.py
```

应用启动时会同步 `deploy/managed/plugins/tools/sjtu_canvas.json` 和 `deploy/managed/plugins/skills/sjtu_canvas.json`。如需临时停用，把对应 JSON 的 `enabled` 或 `is_active` 改为 `false` 后重新同步。
