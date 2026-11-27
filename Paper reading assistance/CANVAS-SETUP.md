# Canvas 学习平台：安装与 Token 配置

## 先选需要的功能

| 需求 | 安装 / 配置 |
| --- | --- |
| 论文阅读、摘要翻译、OCR、注释、论文问答 | 安装 `paper-reading-assistance`；默认使用当前 Agent 模型，不需要 Canvas Token |
| 读取 Canvas 课程、待办、作业、公告、课件或课堂入口 | 另需安装本仓库的完整 `sjtu-canvas` 技能，并配置有效 Canvas API Token |
| 两类功能都使用 | 在 Agent 中同时安装两个技能，Canvas 凭据只配置一次；本文引导使用主技能共用的文件 |

独立论文 ZIP 不包含完整 Canvas 课程客户端。本配置工具仅负责创建共享凭据和检查连接，不把“Token 验证成功”说成“已安装全部 Canvas 功能”。完整 `sjtu-canvas` 来自主仓库根目录（该目录第一层有 `SKILL.md` 和 `scripts/sjtu_canvas.py`）。可下载整个主仓库并按其 `INSTALL.md` 安装，或运行主仓库的图形安装器。不要只把论文 ZIP 改名为 `sjtu-canvas`。

## 第一步：在目标设备安装

1. 安装需要的 Skill 到目标 Agent 的技能目录。论文独立技能安装见 [DEPLOYMENT.md](DEPLOYMENT.md)；完整 Canvas 主技能安装见主仓库 `INSTALL.md`。
2. 论文技能需要 Node.js 22.13+；Canvas 基础课程查询需要 Python 3.9+。论文技能自身不依赖 Python。
3. 在论文技能目录执行 `npm ci --omit=dev`。如果使用主仓库安装器，可让它引导 Canvas 安装与 Token 保存。

## 第二步：创建 Canvas 个人访问令牌

由用户在本机浏览器登录 [交大 Canvas 账户设置](https://oc.sjtu.edu.cn/profile/settings)，在头像/账户 → 设置中找到个人访问令牌相关入口。创建单独用于该技能的令牌，设置合理有效期，只授予所需权限，然后复制完整 Token。

个人令牌可能具有写权限，取决于创建时的范围；不能把“本配置只执行 GET”误认为令牌本身天然只读。学校若没有开放个人 Token 入口，请联系学校 Canvas 管理员取得批准的方式，不改用聊天收集密码、Cookie 或登录会话。

Canvas Token 与模型服务的 API Key 是两种凭据，不能混填。**不要把 Canvas Token 发到 Agent 聊天中、写在命令参数里，或提交到 GitHub。**

## 第三步：在本机配置，二选一

### A. 终端隐藏输入

从论文技能目录执行：

```powershell
node scripts/configure-canvas.mjs setup
node scripts/configure-canvas.mjs check
```

从任意工作目录执行时使用脚本绝对路径。`setup` 必须由用户本人在交互式终端输入，字符不会显示；程序先通过官方 API 验证当前身份，成功后才保存。不接受通过非交互式 Agent 命令传入 Token。

### B. 本机图形引导

运行 `node server.mjs`，点击“模型设置”，展开“连接 Canvas 学习平台（可选，需 API Token）”。页面列出创建步骤和官方链接；粘贴到 **Canvas 专用密码框**，点击“验证并保存共享 Token”。也可以点击“检查现有连接”。

本地页面使用临时会话，只监听回环地址。Token 不放入 URL、不写日志，也不通过读取配置的接口返回。验证失败不覆盖旧文件。

## 保存位置和来源优先级

默认共享文件：`~/.config/sjtu-canvas/token`。在 Windows 通常是 `C:/Users/用户名/.config/sjtu-canvas/token`。新设备需要自行配置该设备的私有凭据；安装 Skill 不会从旧设备复制 Token。

读取优先级：`--token-file` → `SJTU_CANVAS_TOKEN_FILE` → `SJTU_CANVAS_TOKEN` → `CANVAS_API_TOKEN` → `CANVAS_ACCESS_TOKEN` → 默认文件 → 旧版 `~/.jiaoxiaoai/config.json`（或 `JIAOXIAOAI_CONFIG`）兼容回退。

```powershell
node scripts/configure-canvas.mjs status
node scripts/configure-canvas.mjs setup --token-file "C:/private/canvas-token"
node scripts/configure-canvas.mjs check --token-file "C:/private/canvas-token"
```

`status` 只检查本机是否找到凭据，不代表已连接；`check` 才是在线验证。输出显示来源和路径，不显示 Token。新 Token 保存后若仍有更高优先级的环境变量覆盖，程序会明确提示；请清理过期环境变量，或在主 Canvas 命令中指定正确的 `--token-file`。

云端 Agent 没有交互式终端或桌面阅读器时，可由用户通过宿主的私有密钥/环境变量设置提供 `SJTU_CANVAS_TOKEN` 或 `SJTU_CANVAS_TOKEN_FILE`，再让 Agent 运行 `check`。不要把真实值写进提示词、公开命令记录或 GitHub；云端的文件路径必须在其运行环境内可读。

## 第四步：验证完整 Canvas 技能

配置成功后，在完整 `sjtu-canvas` 技能目录执行（macOS/Linux 可用 `python3`）：

```powershell
python scripts/sjtu_canvas.py status --pretty
python scripts/sjtu_canvas.py courses --limit 30 --pretty
```

确认当前用户、课程与预期一致，再在 Agent 中使用“用 sjtu-canvas 查看我未来 14 天的作业”。验证当前用户成功只说明 Token 可用于该接口，具体课程/文件权限仍以相应 API 结果为准。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 没有找到 Token | 在目标设备执行 setup；云端 Agent 的用户目录与桌面用户目录不同 |
| 401 | 令牌无效或过期，重新生成并检查是否被环境变量覆盖 |
| 403 | 检查账号、令牌范围与课程权限 |
| 网络或登录重定向错误 | 检查网络、代理、学校 VPN；程序拒绝把 Token 转发到登录页面 |
| 保存了新 Token 但仍用旧账号 | 查看 effectiveSource/source；环境变量可能优先于默认文件 |
| 论文能读，但 Canvas 命令不存在 | 论文独立包不含完整课程客户端，还需要主 `sjtu-canvas` 技能 |
| 主技能提示 Python 缺失 | 安装 Python 3.9+；论文 Skill 的 Node 环境不能代替它 |

凭据文件不是加密保险库：Unix 尽量设为 `0600`，Windows 取决于用户目录 ACL。删除本地文件不等于撤销云端令牌；不再使用或怀疑泄露时，应在 Canvas 官方设置中撤销。不要把 Token、私人课程资料或配置目录打进分享的 Skill 安装包。
