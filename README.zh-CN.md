# MyAnyAgent — 使用指南

[English](README.md) | 简体中文

MyAnyAgent 是给 **AI agent** 用的工具，由**人**来操作。你不需要自己运行
它的命令——你告诉 agent 想要什么，agent 会驱动这个工具完成。本 README
教你该说什么。

## 一次性安装

```sh
sh install.sh
```

这是你唯一需要亲手执行的步骤。它会安装工具并配置好认证
（GitHub App token，无需密码）。如果缺少前置条件，agent 会明确
告诉你装什么。

前置条件：`git`、Node.js 18+。其余交给 agent——只有当你关心内部
原理时才需要读 [docs/reference.md](docs/reference.md)。

## 准备鉴权凭据（只能由人完成，必需）

在 `sh install.sh` 真正能认证推送之前，**你**必须先准备一个密钥并
填好配置。这些步骤 agent 替代不了——需要你的 GitHub 账号在浏览器
里操作。

### 1. GitHub App 私钥（必需——用于 `git push` 认证）

1. 在你的账号下**注册一个 GitHub App**：
   [官方教程](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)。
   注册时把 **Contents → Read & write** 设为唯一所需权限；webhook
   可以保持关闭。
2. **把它安装到你自己的账号**：
   [安装自己的 GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)，
   选择它覆盖的仓库。
3. 在 App 设置页**生成私钥**：
   [私钥管理](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)。
   把下载的 `.pem` 保存为
   `~/.secrets/myanyagent.<日期>.private-key.pem`（权限 `0600`），
   绝不提交进任何仓库。

### 2. 必须给予的配置

| 文件 | 必填值 | 值从哪里来 |
|---|---|---|
| `~/.config/myanyagent/config.toml`（机器级，由 `install.sh` 写入） | `client_id`、`app_id`、`private_key` | App 设置页显示 **App ID** 和 **Client ID**；`private_key` 即上面 `.pem` 的路径 |
| `<repo>/.myanyagent.toml`（每仓库） | `repository`、`installation_id`、`[bot]` 名/邮箱 | `installation_id` 是安装配置页 URL 里的数字（`github.com/settings/installations/<id>`）；`[bot]` 名是 App 页显示的 app-slug 形式（如 `MyAnyAgent[bot]`），邮箱格式为 `<bot用户id>+<bot名>@users.noreply.github.com` |

文件就位后，在仓库里运行 `myanyagent-bootstrap`（或交给 agent），
工具即生效。逐字段完整说明见
[docs/reference.md](docs/reference.md)。

### 3. 上游 PAT（可选——第三方公共仓库贡献）

对未安装你的 App 的仓库评论/开 PR，需要一个 classic PAT：
[创建 classic personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)，
scope 只选 **`public_repo`**，保存到
`~/.secrets/myanyagent-upstream.pat`（权限 `0600`）。只往自己仓库
推送的话可跳过。

## 在启用 MyAnyAgent 的仓库中工作

仓库里存在 `.myanyagent.toml` 文件即表示已启用。像平常一样和
agent 协作即可：

- **"把这几个提交推上去"** → agent 直接推送，认证自动完成
- **"向上游开一个 PR"** → agent 运行 PR 命令；若任何提交缺少
  AI 披露（`Co-authored-by:`）会被拒绝——trailer 会自动附加，
  所以你几乎不会遇到这个报错
- **"在那个仓库的 PR #12 下评论"** → agent 通过白名单 upstream
  适配器完成

你不需要知道哪条命令干什么。agent 只会在两种情况下找到你：

1. **新仓库首次使用** —— agent 可能请你在那里运行一次
   `myanyagent-bootstrap`（一条命令，一次而已）。
2. **出问题了** —— agent 会看到 `-> run: ...` 提示并自己修好，
   顺着工具的自描述消息走。

## 你可以让 agent 做什么

| 你说 | 发生什么 |
|---|---|
| "推送我的分支" | GitHub App token 认证；提交自动携带 AI 披露 |
| "Fork 这个仓库并开 PR" | 通过 dry-run 优先的适配器 fork + 开 PR（每次写操作先展示计划） |
| "在上游 PR 评论 / 回复 / resolve 线程" | 以你的身份做白名单内的 API 写操作，绝不静默——确认前一律 dry-run |
| "这里认证状态如何？" | `myanyagent-status` 报告：全绿（`OK`）或 `-> run:` 修复提示 |
| "读我的 GitHub 通知 / PR review" | 只读命令，零风险 |

## 为什么可以放心让 agent 驱动

- 所有上游写操作**先 dry-run**——agent 先看到将要发送什么，
  然后才会真的发生。
- 只有**固定白名单内的端点**可调用，其余一律拒绝。
- Token **短时效或文件锁（0600）**，绝不进 argv、URL 或日志。
- **AI 披露是强制的**：提交自动携带 `Co-authored-by:`，包含
  未披露 AI 提交的 PR 会被拒绝创建。
- 任何失败工具都会打印 `-> run:` 提示——agent 自愈，不会乱撞。

## OpenCode 用户

如果你使用 [OpenCode](https://opencode.ai)，安装随附的 skill，
agent 从一开始就认识 MyAnyAgent：

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

## 延伸阅读

- [docs/reference.md](docs/reference.md) — 完整内部原理：配置
  文件、凭据流、白名单、命令
- [docs/contributing-to-third-party-repos.md](docs/contributing-to-third-party-repos.md)
  — 上游模型背后的调研记录

## 测试

测试套件也与 agent 相关——对 agent 说"运行 myanyagent 测试"它
就知道怎么做：

```sh
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
node --test test/attribution.test.cjs
sh test/hooks.test.sh
sh test/bootstrap.test.sh
sh test/status.test.sh
sh test/install.test.sh
```