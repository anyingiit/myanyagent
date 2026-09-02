# MyAnyAgent — 可复用的 GitHub App Git 认证工具

[English](README.md) | 简体中文

一个机器级工具：用 GitHub App installation token 认证 `git push`，在
同一 App 授权的所有仓库间复用。无需每仓库单独脚本——每个仓库只需
提交一个声明参数的小文件 `.myanyagent.toml`。

## 安装（每台机器一次）

```sh
# 在本仓库的克隆中执行：
sh install.sh
```

工具会安装到 `~/.local/share/myanyagent/`，在 `~/.local/bin/` 创建
symlink，并写入 `~/.config/myanyagent/config.toml`。

前置条件：`git`、Node.js 18+、以及位于
`~/.secrets/myanyagent.<日期>.private-key.pem` 的 GitHub App 私钥
（需另行准备，切勿提交进仓库）。

离线/隔离网机器可用 `MYANYAGENT_SKIP_SMOKE_TEST=1` 跳过 bootstrap 中
需要访问 GitHub 的凭据冒烟测试。

## 每仓库配置

1. 在 GitHub App 设置中把该仓库加入 selected repositories。
2. 在仓库根目录创建 `.myanyagent.toml`：

   ```toml
   repository = "owner/repo"
   installation_id = "123456"
   [bot]
   name = "MyAnyAgent[bot]"
   email = "123456789+myanyagent[bot]@users.noreply.github.com"
   ```

3. 提交该文件。
4. 在仓库内运行 `myanyagent-bootstrap`。
5. `git push` 验证。

## Agent 自发现（AI 代理如何零知识学会使用本工具）

本工具专为 agent 使用而设计，无需预先记忆任何命令：

- 仓库里存在 `.myanyagent.toml` 即声明使用 MyAnyAgent。
- `git push` 认证失败时，credential helper 会在 stderr 输出修复
  提示：`-> run: myanyagent-status`。
- `myanyagent-status` 报告状态，需要行动时输出 `-> run: <命令>`
  （全部正常时输出 `OK`）。
- agent 顺着 `-> run:` 行自愈。

### OpenCode skill

仓库内附带一个 [OpenCode skill](https://opencode.ai)：
`skills/myanyagent/SKILL.md`。安装或 symlink 到用户 skills 目录即可
让 OpenCode agent 自动加载：

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

该 skill 告诉 agent 何时使用 MyAnyAgent、GitHub App
credential-helper 流程如何运作、应运行哪些命令
（`myanyagent-status`、`myanyagent-bootstrap`、`myanyagent-upstream`）
——与上述运行时 `-> run:` 提示互为补充。

## 命令

| 命令 | 用途 |
|------|------|
| `myanyagent-bootstrap` | 依据 `.myanyagent.toml` + 机器配置写入本地 `.git/config` |
| `myanyagent-status` | 只读状态报告，带 `-> run:` 提示 |
| `myanyagent-helper` | Git credential helper（由 git 调用，不直接使用） |
| `myanyagent-upstream` | 面向第三方公共仓库贡献的 GitHub API 白名单适配器 |

## 向第三方公共仓库贡献

App installation token 只能操作 App 安装覆盖的仓库。对于你无控制权的
上游仓库，使用一个刻意保持小型的独立适配器：

- **Git 传输**（push 到你自己的 fork）仍走 App credential
  helper——不变。
- **上游 API 写操作**（创建 fork、发起 PR、评论、回复 review 线程、
  resolve 线程）通过 `myanyagent-upstream`，它持有人类账号的 classic
  PAT（`public_repo`），位于 `~/.secrets/myanyagent-upstream.pat`
  （权限 0600）。所有写操作默认 dry-run，除非传入 `--yes`；仅固定
  白名单内的端点可调用。
- **提交署名**与认证正交。向上游供 PR 的 worktree 在
  `.myanyagent.toml` 中声明人类身份：

  ```toml
  [identity]
  name = "your-username"
  email = "<id>+your-username@users.noreply.github.com"
  ```

  `myanyagent-bootstrap` 随后把人类身份（而非 bot）写入 git config，
  并把 `.myanyagent.toml` 加入 `.git/info/exclude`，使其永不进入
  PR diff。`myanyagent-upstream identity` 会打印 PAT 账号精确的
  git config 行（及 ID 型 noreply 地址）。
- **AI 披露是强制性的，而非建议性的。** 每个提交都携带指明 agent
  的 `Co-authored-by:` trailer。Bootstrap 安装
  `prepare-commit-msg` hook 自动附加解析出的 trailer
  （优先级：`MYANYAGENT_ATTRIBUTION` 环境变量 > `[identity].co_author`
  > `[bot]` 块；`--no-verify` 并不会跳过 `prepare-commit-msg`）；
  `myanyagent-upstream pr create` 在 `<base>..<head-branch>`（即
  PR 将包含的内容）中任一提交缺少该 trailer 时拒绝开 PR——gate
  在本地解析 base ref，若缺失请先 `git fetch origin <base>`
  （`--skip-attribution-check` 可绕过）。`myanyagent-status` 报告
  hook 状态、解析出的 trailer，以及自 `origin/HEAD` 以来缺失它的
  提交。

完整的能力调研与失败记录见
`docs/contributing-to-third-party-repos.md`。

## 测试

```sh
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
node --test test/attribution.test.cjs
sh test/hooks.test.sh
sh test/bootstrap.test.sh
sh test/status.test.sh
sh test/install.test.sh
```