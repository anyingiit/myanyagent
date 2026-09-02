# MyAnyAgent — 使用指南

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