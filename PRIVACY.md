# 交小AI隐私说明

## 我们承诺什么

交小AI是本地运行的开源 skill，没有作者服务器，不收集账号信息，不包含遥测、广告或统计上报，也不会把课程资料上传到作者或第三方资料库。

本说明描述的是 skill 自身的代码行为，不是“任何情况下绝对不会泄露”的保证。学校服务、DSH 及其模型服务、浏览器、操作系统和第三方依赖有各自的数据处理规则。

## 数据存放在哪里

- **Canvas Token**：由用户本人在交互式终端隐藏输入，不通过聊天传递。基础 Python CLI 和高级 Node 模块共用同一套 Token 来源，默认文件为 `~/.config/sjtu-canvas/token`。Node `setup` 只有在在线验证成功后才写入该文件；旧版 `~/.jiaoxiaoai/config.json` 只作为兼容回退。macOS / Linux 会尝试将技能 Token 文件权限设为 `0600`，Windows 的实际保护取决于用户目录 ACL。这些文件都不是加密保险库，设备或系统账号被入侵时仍可能泄露。
- **课堂登录状态**：只存在于本次临时浏览器会话的内存中。skill 不读取用户日常 Chrome 的个人资料，不把 Cookie、JWT 或登录 URL 写入配置，命令结束后关闭浏览器。
- **PPT 与 TXT 文稿**：只写入用户明确指定的本机目录，不覆盖已有文件。TXT 在 macOS / Linux 以 `0600` 权限保存。

## 数据会发送到哪里

- Canvas 查询和鉴权发送到 `https://oc.sjtu.edu.cn`。
- 课堂查询发送到 `https://v.sjtu.edu.cn`；登录过程中会按照学校页面的官方跳转完成 jAccount 登录。
- PPT 下载可能跳转到 `s3.jcloud.sjtu.edu.cn` 或其子域名。跳转请求不携带 Canvas Token，其他域名会被拒绝。
- 安装依赖和可选 Chromium 时，npm 与 Playwright 会访问各自的软件分发服务；这不会携带 Canvas Token 或课程资料。

skill 源码只发起课程资料功能所需的读取和下载请求，不修改 Canvas 课程内容。

## DSH 与模型服务的边界

通过 DSH 或其他智能体使用时，工具输出会进入当前会话，并可能被用户配置的模型服务处理：

- 列出课程、文件或录像时，课程名、文件名、日期和 ID 等元数据会进入工具输出。
- 使用 `classroom read` 阅读文稿或 `classroom search` 检索关键词时，返回的命中段落正文会进入工具输出。
- 使用下载命令时，skill 只返回保存状态、路径、文件元数据和错误信息，不把 PPT 或 TXT 正文作为工具输出返回，也不主动读取已下载文件。

如果用户不希望文稿正文进入模型上下文，应使用导出命令并在本地查看，而不是使用阅读或搜索命令。DSH 的会话保存和模型服务数据处理由用户所选 DSH 配置与服务条款决定，不在本 skill 控制范围内。

## 退出与撤销

删除本地配置：

```bash
node scripts/jiaoxiaoai.mjs logout
```

该命令默认删除技能共用的默认 Token 文件和旧版兼容配置，但不删除已下载文件，也不会撤销 Canvas 云端 Token。自定义或共享 Token 文件必须增加 `--confirm-token-file` 才会删除。若通过 `SJTU_CANVAS_TOKEN`、`CANVAS_API_TOKEN` 或 `CANVAS_ACCESS_TOKEN` 环境变量配置了 Token，还需自行清除对应环境变量。

不再使用或怀疑 Token 泄露时，应立即到 <https://oc.sjtu.edu.cn/profile/settings> 撤销对应 Token。建议创建 Token 时设置合理的有效期，并为交小AI单独创建一个 Token，不要与其他用途混用。

## 可核验性

仓库包含本 skill 的完整源码、锁定版本的依赖清单和可复现发行包构建脚本；发行 zip 附带独立 SHA-256 校验文件，并排除 `.git`、开发用 `node_modules`、`dist` 和常见临时文件。自动测试覆盖 Token 权限、非信任下载重定向、课堂接口域名限制、单录像搜索和异常响应不返回敏感正文。导出命令只返回路径和状态，不返回文稿正文。

这些措施用于降低风险，不能替代操作系统安全、浏览器与依赖更新、DSH 隐私配置及学校服务的安全保障。
