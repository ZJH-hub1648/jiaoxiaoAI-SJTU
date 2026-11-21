# SJTU Canvas 技能安装指南

这份指南先面向 **Windows 10/11 + PowerShell**。你不需要修改 Python 代码，也不需要把 Canvas 令牌发给聊天机器人。macOS 和 Linux 的路径不同，后续可以单独补充。

如果你更喜欢阅读排版后的文档，可以下载 [Windows Word 版安装指南](docs/SJTU_Canvas技能安装指南_Windows版.docx)。

先记住一句话：

> 一个 Skill 就是一个文件夹，文件夹第一层必须有 `SKILL.md`。智能体会读取它，并在需要时运行里面的 Python 程序。

安装分三步：

1. 把技能文件夹放到智能体能找到的位置。
2. 在电脑上保存一次 Canvas 令牌。
3. 在聊天框里输入 `sjtu-canvas` 或直接描述任务。

先看三个平台的区别：

| 平台 | Windows 安装位置 | 聊天框里的调用方式 |
| --- | --- | --- |
| Codex | `C:\Users\<用户名>\.agents\skills\sjtu-canvas` | `$sjtu-canvas 查看本周作业` |
| DeepSeek Harness | `C:\Users\<用户名>\.dsh\skills\sjtu-canvas` | `/sjtu-canvas 查看本周作业` |
| WorkBuddy | `C:\Users\<用户名>\.workbuddy\skills\sjtu-canvas` | 在技能列表选择，或直接说“用交小AI校园技能查看本周作业” |

下面每种平台只需要选一种安装方式；不要同时执行个人目录和项目目录两种命令。

## 准备工作

- Windows 10 或 Windows 11。
- 有 PowerShell；Windows 自带的 Windows PowerShell 也可以。
- Python 3.9 或更高版本。
- 可以访问上海交大 Canvas 的网络；校外使用时通常需要学校 VPN。
- 一个有效的 Canvas 个人访问令牌。
- 智能体本身允许执行本地命令和访问网络。

> 如果智能体运行在云端，而不是你的电脑上，它通常看不到你电脑里的令牌文件。此时要把令牌放进该平台的“密钥/环境变量”功能，或放入它的工作区，不要把令牌上传到 GitHub。

基础的课程、作业和公告查询只需要 Python。若还要下载 PPT 或使用课堂语音文稿，需要另外安装 Node.js 22+，然后在技能根目录执行：

```powershell
npm ci
node scripts/jiaoxiaoai.mjs status
```

高级模块与 Python 查询共用同一套 Token 来源，默认都读取 `~/.config/sjtu-canvas/token`。旧版 `~/.jiaoxiaoai/config.json` 只作为兼容回退，不再要求新用户维护第二份配置。

如果尚未保存 Token，由你本人在交互式终端运行：

```powershell
node scripts/jiaoxiaoai.mjs setup
```

命令会隐藏输入、在线验证成功后再保存。不要把 Token 发到聊天中。课堂登录默认使用系统 Chrome；没有 Chrome 时执行 `npm run install:browser`。

## 第一步：准备技能文件夹

推荐直接下载仓库。在 PowerShell 中运行：

```powershell
git clone https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU.git sjtu-canvas
```

如果电脑没有 Git，也可以在仓库页面选择 **Code → Download ZIP**，解压后把最外层文件夹改名为 `sjtu-canvas`。

上面的 `git clone` 和“下载 ZIP”**二选一**即可。

如果你已经解压了 ZIP，也可以直接用文件资源管理器把 `sjtu-canvas` 文件夹复制到下面表格列出的目标位置，不必使用 Git。

正确结构应当是这样：

```text
sjtu-canvas\
├── SKILL.md
├── INSTALL.md
├── package.json
├── package-lock.json
├── scripts\
│   ├── sjtu_canvas.py
│   ├── jiaoxiaoai.mjs
│   └── lib\
├── references\
├── agents\
└── tests\
```

`SKILL.md` 必须直接位于 `sjtu-canvas` 文件夹里，不要再套一层同名目录。

## 第二步：保存 Canvas 令牌

1. 登录上海交大 Canvas。
2. 打开个人账户设置，找到“访问令牌/个人访问令牌”相关入口。
3. 创建一个只供这个技能使用的令牌。
4. 在 PowerShell 中运行下面两行，创建私有令牌文件并打开记事本：

```powershell
New-Item -ItemType Directory -Force "$HOME\.config\sjtu-canvas" | Out-Null
notepad "$HOME\.config\sjtu-canvas\token"
```

5. 把令牌粘贴到记事本中，保存并关闭。

之后 Codex、DeepSeek Harness 和 WorkBuddy 都可以自动读取：

```text
~/.config/sjtu-canvas/token
```

在 Windows 上，它通常展开为：

```text
C:\Users\<你的用户名>\.config\sjtu-canvas\token
```

不要把这个文件放进技能仓库，也不要在聊天中粘贴令牌。

如果智能体不支持读取这个默认位置，也可以在启动智能体前设置：

```powershell
$env:SJTU_CANVAS_TOKEN_FILE = "$HOME\.config\sjtu-canvas\token"
```

临时设置环境变量后，重新启动智能体通常才会生效。

Python 与 Node.js 支持的统一 Token 优先顺序为：

1. `--token-file`
2. `SJTU_CANVAS_TOKEN_FILE`
3. `SJTU_CANVAS_TOKEN`
4. `CANVAS_API_TOKEN`
5. `CANVAS_ACCESS_TOKEN`
6. 默认文件 `~/.config/sjtu-canvas/token`
7. 旧版兼容配置 `~/.jiaoxiaoai/config.json`

默认 `logout` 会删除技能 Token 文件和旧版兼容配置，但不会删除下载文件或撤销 Canvas 云端 Token。若使用了自定义或共享 Token 文件，必须明确添加 `--confirm-token-file`：

```powershell
node scripts/jiaoxiaoai.mjs logout
node scripts/jiaoxiaoai.mjs logout --token-file "C:\path\to\shared-token" --confirm-token-file
```

## 第三步：安装到 Codex

### 个人使用

把技能放到用户级目录：

```powershell
$target = "$HOME\.agents\skills\sjtu-canvas"
if (Test-Path -LiteralPath $target) { throw "目标目录已经存在，请先确认是否已经安装。" }
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null
git clone https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU.git $target
```

最终应存在：

```text
C:\Users\<你的用户名>\.agents\skills\sjtu-canvas\SKILL.md
```

### 只在某个项目中使用

把技能放进该项目的隐藏目录：

```text
<项目目录>\.agents\skills\sjtu-canvas\SKILL.md
```

Codex 通常会自动发现技能变化；如果列表中没有出现，关闭并重新打开 Codex。

### 在 Codex 中调用

在聊天框中输入，不是在 PowerShell 中输入：

```text
$sjtu-canvas 检查 Canvas 连接
```

也可以说：

```text
用 sjtu-canvas 查看我未来 14 天的作业，按截止时间排序
```

Codex 也提供 `/skills` 或技能选择界面。先选择 **交小AI校园技能**，再说任务也可以。技能标识仍为 `sjtu-canvas`。

官方参考：[Build skills — OpenAI Developers](https://developers.openai.com/codex/skills)

## 第四步：安装到 DeepSeek Harness

这里的 Harness 指 DeepSeek Harness，简称 DSH。其他 harness 只要支持 `SKILL.md`，核心做法相同，只是技能目录可能不同。

### 所有项目都能使用

默认安装到用户目录：

```powershell
$target = "$HOME\.dsh\skills\sjtu-canvas"
if (Test-Path -LiteralPath $target) { throw "目标目录已经存在，请先确认是否已经安装。" }
New-Item -ItemType Directory -Force "$HOME\.dsh\skills" | Out-Null
git clone https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU.git $target
```

如果你设置了 `DSH_HOME`，则改成：

```powershell
$target = "$env:DSH_HOME\skills\sjtu-canvas"
```

最终应存在：

```text
C:\Users\<你的用户名>\.dsh\skills\sjtu-canvas\SKILL.md
```

### 只在某个项目中使用

```text
<项目目录>\.dsh\skills\sjtu-canvas\SKILL.md
```

安装后重启 DeepSeek Harness，或者刷新它的扩展/技能列表。

### 在 DeepSeek Harness 中调用

通常可以通过斜杠命令显式调用：

```text
/sjtu-canvas 检查连接并列出未来 7 天的作业
```

也可以在扩展坞或技能菜单中选择 **交小AI校园技能**，然后直接说：

```text
查看我的 Canvas 课程
```

不同 DSH 版本的菜单名称可能略有差异。

## 第五步：安装到 WorkBuddy

### 方法一：使用 WorkBuddy 的导入功能，推荐

1. 在 GitHub 页面下载仓库 ZIP。
2. 解压，并把最外层文件夹改名为 `sjtu-canvas`。
3. 打开 WorkBuddy 的 **Skills / 技能 / 技能中心**。
4. 点击 **Import / 导入技能 / 添加本地技能**。
5. 选择 `sjtu-canvas` 文件夹或压缩包。
6. 确认技能列表出现 **交小AI校园技能**。

如果导入时只能选择文件，请选择文件夹内的 `SKILL.md` 或整个 ZIP；不同 WorkBuddy 版本的按钮名称可能不同。

### 方法二：手动复制到本机技能目录

WorkBuddy 常见的本机技能目录是：

```text
C:\Users\<你的用户名>\.workbuddy\skills\sjtu-canvas
```

可以这样创建：

```powershell
$target = "$HOME\.workbuddy\skills\sjtu-canvas"
if (Test-Path -LiteralPath $target) { throw "目标目录已经存在，请先确认是否已经安装。" }
New-Item -ItemType Directory -Force "$HOME\.workbuddy\skills" | Out-Null
git clone https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU.git $target
```

安装后重启 WorkBuddy。正确的检测标准仍然是：

```text
C:\Users\<你的用户名>\.workbuddy\skills\sjtu-canvas\SKILL.md
```

### 在 WorkBuddy 中调用

先在技能列表中选择 **交小AI校园技能**，然后输入：

```text
检查 Canvas 连接
```

如果当前版本支持技能斜杠命令，也可以输入：

```text
/sjtu-canvas 查看本周作业
```

即使看不到斜杠命令，通常也可以用自然语言触发：

```text
请用交小AI校园技能查看我最近需要完成的作业
```

## 第一次测试

### 方法一：让智能体测试

在任意已安装技能的智能体中输入：

```text
请使用 sjtu-canvas 检查 Canvas 连接；成功后列出我未来 7 天的作业，并按截止时间排序。
```

### 方法二：手动运行

以 Codex 的用户级安装为例：

```powershell
python "$HOME\.agents\skills\sjtu-canvas\scripts\sjtu_canvas.py" status --pretty
```

DeepSeek Harness：

```powershell
python "$HOME\.dsh\skills\sjtu-canvas\scripts\sjtu_canvas.py" status --pretty
```

WorkBuddy：

```powershell
python "$HOME\.workbuddy\skills\sjtu-canvas\scripts\sjtu_canvas.py" status --pretty
```

正常时会看到当前用户资料和 `"ok": true`。

再测试作业：

```powershell
python "$HOME\.agents\skills\sjtu-canvas\scripts\sjtu_canvas.py" upcoming --days 14 --pretty
```

## 常见问题

| 现象 | 含义 | 处理方法 |
| --- | --- | --- |
| 技能列表看不到交小AI校园技能 | 目录层级不对或尚未刷新 | 确认 `SKILL.md` 在 `sjtu-canvas` 第一层，然后重启智能体 |
| `configuration_error` | 没有找到令牌 | 检查 `~/.config/sjtu-canvas/token` 是否存在并有内容 |
| `authentication_error` | 令牌无效或过期 | 在 Canvas 重新生成令牌并覆盖旧文件 |
| `network_error` | 无法连接 Canvas | 检查网络、代理和学校 VPN |
| `permission_error` | 令牌没有读取该课程的权限 | 检查 Canvas 账户权限或令牌范围 |
| Canvas 中没有“访问令牌”入口 | 学校可能关闭了个人令牌 | 使用学校提供的认证方式，或联系 Canvas 管理员确认政策 |
| `Python was not found` | 没装 Python 或命令名不对 | 安装 Python 3.9+，Windows 通常使用 `python` |
| WorkBuddy 提示不能运行命令 | 当前智能体缺少命令执行能力 | 换成允许运行本地命令的 WorkBuddy 模式，或使用其命令行/桌面版本 |

## 最省事的安装提示词

如果你不想手动移动文件夹，可以把下面这段直接发给 Codex、DeepSeek Harness 或 WorkBuddy：

```text
请把 https://github.com/ZJH-hub1648/jiaoxiaoAI-SJTU 安装为名为 sjtu-canvas 的 Agent Skill。
目标目录必须保证 SKILL.md 位于 sjtu-canvas 文件夹第一层。
安装后运行 python scripts/sjtu_canvas.py status 验证。
不要读取、打印或上传我的 Canvas 令牌。
```

安装完成后，你的日常用法只需要一句话，例如：

```text
用 sjtu-canvas 看看我这两天还有哪些作业。
```
