# MyAnyAgent

[English](README.md) | 简体中文

MyAnyAgent 让 **AI agent** 替你向 GitHub 推送代码——不需要密码，也
不需要把 PAT 留在仓库里。你只需在浏览器里做一次设置；之后你只要告诉
agent 想要什么（"推上去"、"向上游开 PR"），认证由它自己完成。

**一行说清原理：** 你注册一个 GitHub App（一次性），agent 用它的私钥
为每次推送换取短时效 token；同时每个提交自动附加 `Co-authored-by:`
AI 披露 trailer。

## 从零到能用（约 10 分钟）

### 第 0 步 — 前置条件

一台装有 `git` 和 Node.js 18+ 的 Linux/macOS 机器：

```sh
git --version && node --version
```

### 第 1 步 — 创建你的 GitHub App（浏览器，约 5 分钟）

1. 按照官方教程
   [注册一个 GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)。
   注册时注意：
   - **权限**：只设 **Contents → Read and write**（其余都保持 "No access"）
   - **Webhook**：取消 "Active"（用不到）
   - **可安装范围**："Only on this account"
2. 创建完成后，在同一设置页点击 **"Generate a private key"** 下载
   `.pem` 文件。（教程：
   [私钥管理](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)。）
3. 把 App 安装到你自己的账号上：
   [官方教程](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)，
   勾选你要推送的仓库。

**在 App 设置页记下三个值：** **App ID**、**Client ID**，以及安装的
数字 ID（打开 `https://github.com/settings/installations/<ID>` 的配置
页时，URL 里的数字）。

### 第 2 步 — 把私钥保存到本机

```sh
mkdir -p ~/.secrets
mv ~/Downloads/*.pem ~/.secrets/myanyagent.private-key.pem
chmod 600 ~/.secrets/myanyagent.private-key.pem
```

（路径随意——下一步配置会指向它。绝不提交进仓库。）

### 第 3 步 — 安装 MyAnyAgent

```sh
git clone https://github.com/anyingiit/myanyagent.git
cd myanyagent
sh install.sh
```

然后编辑它打印出来的配置文件：

```sh
nano ~/.config/myanyagent/config.toml    # 或任意编辑器
```

填入第 1 步记下的三个值：

```toml
client_id  = "Iv23xxxxxxx"     # <- App 页的 Client ID
app_id     = "12345678"        # <- App 页的 App ID
private_key = "~/.secrets/myanyagent.private-key.pem"
```

如果 `~/.local/bin` 不在 PATH（install.sh 会警告），加上它：

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile && . ~/.profile
```

### 第 4 步 — 启用一个仓库（每仓库一次）

在你要推送的仓库里创建 `.myanyagent.toml`：

```toml
repository = "you/your-repo"    # <- 该文件所在的仓库
installation_id = "123456"     # <- 第 1 步安装页 URL 里的数字
[bot]
name  = "your-app[bot]"        # <- App 页显示的 bot 名
email = "11111111+your-app[bot]@users.noreply.github.com"
#       ^ bot 用户 ID（App 设置 → Advanced 页可见），加 app slug
```

提交它，然后运行：

```sh
myanyagent-bootstrap
```

完成——`git push` 现在通过你的 App 认证。验证一下：

```sh
myanyagent-status    # 结尾应显示: OK
```

### 可选 — 上游贡献（第三方公共仓库）

要评论 / 开 PR 的仓库**没有**安装你的 App 时，补一个 classic PAT：
[官方教程](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
（scope 只选 `public_repo`）：

```sh
install -m 600 /dev/stdin ~/.secrets/myanyagent-upstream.pat <<< "ghp_xxxx"
```

只往自己仓库推送的话可跳过。

## 日常使用 — 直接对 agent 说

从这里开始，**你再也不需要亲自运行任何工具命令**。说：

| 你说 | 发生什么 |
|---|---|
| "推送我的分支" | agent 推送；认证自动完成；提交自动携带 AI 披露 |
| "fork 这个仓库并开 PR" | 先 dry-run 展示，确认后执行 |
| "在上游 PR #12 下评论" | 白名单内的 API 写操作，先 dry-run |
| "把上游 issue #5 关闭为 completed" | 带原因的 `issue close` |
| "看下认证状态" | agent 运行 `myanyagent-status`，顺着 `-> run:` 提示自愈 |

工具是自描述的：任何环节出错都会打印 `-> run: <命令>`，agent（或你）
永远知道下一步是什么。

## OpenCode 用户

装上随附的 skill，agent 从一开始就认识这个工具：

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

## 深入了解

- [docs/reference.md](docs/reference.md) — 每个配置字段、token 签发
  流程、端点白名单、全部命令
- [docs/contributing-to-third-party-repos.md](docs/contributing-to-third-party-repos.md)
  — 上游模型背后的调研笔记
- [README.md](README.md) — 同一指南的英文版

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