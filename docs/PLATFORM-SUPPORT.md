# 交小AI校园技能跨平台支持矩阵

本文只记录可复现的验证结果，不把代码可移植性等同于真实账号已验收。

## 支持级别

| 标记 | 含义 |
| --- | --- |
| 自动测试通过 | 当前代码已通过对应操作系统的自动测试 |
| CI 待运行 | 已配置持续集成，但尚未看到对应系统结果 |
| 真实账号待验收 | 需要有效 Canvas Token、可访问的学校网络及真实课程/录像 |
| 已支持 | 自动测试和真实账号端到端验收均通过 |

## 当前矩阵

| 平台 | 图形安装向导 | 基础 Canvas 自动测试 | PPT / 课堂自动测试 | 真实账号端到端 |
| --- | --- | --- | --- | --- |
| Windows 10/11 | 本地浏览器应用窗口通过 | 本地与 CI 通过 | 本地与 CI 通过 | 本地真实课程读取通过 |
| Ubuntu 24.04 | 浏览器回退，待实机验收 | CI 通过 | CI 通过 | 真实账号待验收 |
| macOS | 浏览器回退，待实机验收 | CI 通过 | CI 通过 | 真实账号待验收 |

2026-11-21 的持续集成运行覆盖 Windows、Ubuntu 24.04 和 macOS，Python 3.9 / 3.12 共 6 个组合全部通过。2026-11-22 在 Windows 使用真实 Canvas Token 完成安装向导四步流程，读取到当前账号的 9 门课程，并验证了可选 npm 组件安装。自动测试还覆盖 Token 读取与退出、Canvas 同源限制、安装会话、PPT 安全下载、课堂域名限制、文稿读取与分页、单录像关键词搜索和发行包校验。

## 安装命令

Windows PowerShell：

```powershell
npm ci
node scripts/jiaoxiaoai.mjs status
node scripts/jiaoxiaoai.mjs setup
python scripts/sjtu_canvas.py status
```

macOS / Linux：

```bash
npm ci
node scripts/jiaoxiaoai.mjs status
node scripts/jiaoxiaoai.mjs setup
python3 scripts/sjtu_canvas.py status
```

`setup` 必须由用户本人运行，输入不可见。不要把 Token 放进聊天、仓库或命令参数。

推荐先运行图形向导：

```powershell
.\start-installer.cmd
```

## 高级功能测试命令

先使用真实课程和录像 ID 定位资源：

```text
node scripts/jiaoxiaoai.mjs canvas courses --query "课程关键词"
node scripts/jiaoxiaoai.mjs classroom courses --query "课程关键词"
node scripts/jiaoxiaoai.mjs classroom videos --course 课程ID
```

搜索、按时间读取和导出分别使用：

```text
node scripts/jiaoxiaoai.mjs classroom search --video 录像ID --query "关键词"
node scripts/jiaoxiaoai.mjs classroom read --video 录像ID --start 60 --end 180
node scripts/jiaoxiaoai.mjs classroom download --course 课程ID --videos 录像ID --directory "本机绝对目录"
```

Windows 的绝对目录示例为 `C:/Users/name/Downloads/course`；macOS / Linux 使用实际存在的本机绝对路径。

## 真实账号验收记录

真实账号验收需要逐项记录：

1. 状态检查成功并使用预期 Token 来源。
2. 真实课程、作业和公告字段正确。
3. PPT 可打开，重复下载不覆盖。
4. 课堂课程与录像 ID 正确，登录流程成功。
5. 搜索命中时间与正文正确，并能按时间补读上下文。
6. TXT 导出标题、时间戳和正文完整，重复导出不覆盖。
7. 暂无文稿、错误 ID、失效登录和无权限可以被区分。

在完成这些记录前，Windows、Linux 和 macOS 都不能标记为“已支持”。

## 本地发行包

```text
npm run release
```

输出位于 `dist/releases/`，包含带版本号、UTF-8 文件名的 ZIP 和独立 SHA-256 校验文件。发行包排除 `.git`、`node_modules`、`dist` 和常见临时文件。

Windows 校验：

```powershell
Get-FileHash "dist/releases/sjtu-canvas-v1.4.0-rc.1.zip" -Algorithm SHA256
Get-Content "dist/releases/sjtu-canvas-v1.4.0-rc.1.zip.sha256"
```

macOS / Linux 校验：

```bash
shasum -a 256 -c "dist/releases/sjtu-canvas-v1.4.0-rc.1.zip.sha256"
```

带 `v*` 的 Git 标签会触发三平台自动测试；全部通过后，持续集成构建 ZIP、附带 SHA-256 并创建 GitHub 预发行版。
