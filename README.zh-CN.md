# MyAnyAgent

[English](README.md) | 简体中文

MyAnyAgent 让你的 **AI agent** 替你向 GitHub 推送代码、管理 PR 和
issue——你不需要经手任何密码或 token。

你不用自己安装任何东西。**对 agent 说：**

> "在这台机器上安装 myanyagent，仓库是
> https://github.com/anyingiit/myanyagent"

agent 会跑完整个安装流程，并且**只**回来找你一次，给你一份简短的
浏览器清单（创建你自己的 GitHub App 和它的密钥——这是唯一真正
需要你 GitHub 账号的部分）。你把清单要的几个值交回之后，就永远
不用再管了。

## 你会被要求做的事（一次性清单）

当 agent 来问时，你在浏览器里做三步（约 5 分钟），再给它四个值：

1. 在账号设置里**注册一个 GitHub App**
   （[官方教程](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)）
   ——注册时把权限只设 **Contents: Read and write**（唯一必需的），
   webhook 保持关闭
2. 在 App 设置页**生成私钥**
   （[官方教程](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)）
   ——下载 `.pem` 文件
3. **把 App 安装到你自己的账号**
   （[官方教程](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)）
   ——勾选你想让 agent 推送的仓库

然后把这几样交给 agent：**Client ID**、**App ID**、下载的
**.pem 文件**，以及**安装 ID**（打开安装配置页时 URL 里的数字：
`github.com/settings/installations/<ID>`）。

这就是人类的全部工作。剩下的——安装、配置、每仓库设置、故障
恢复——都由 agent 自己完成，跟着工具内置的 `-> run:` 提示走。

## 装好之后：你可以怎么说

| 你说 | agent 做什么 |
|---|---|
| "推送我的分支" | 通过你的 App 认证；提交自动带 AI 披露 |
| "fork X 并向上游开 PR" | 先给你看计划，确认后执行 |
| "在上游 PR #12 评论" / "关闭 issue #5" | 白名单内的 API 写操作，先展示计划 |
| "为什么推不上去？" | 运行 `myanyagent-status`，自愈或告诉你缺什么 |

## 为什么这样是安全的

- 第三方仓库上的每个写操作**先 dry-run**——不会有任何静默操作
- 只有**固定白名单**内的 GitHub 端点可调用
- Token **短时效**，密钥保存在 `0600` 文件里，绝不进 git 历史或日志
- 每个提交自动携带 `Co-authored-by:` AI 披露——由 git hook 强制，
  而不是靠自觉

## OpenCode 用户

如果你用 [OpenCode](https://opencode.ai)，装上随附的 skill，agent
从一开始就掌握上述一切：

```sh
mkdir -p ~/.config/opencode/skills
ln -s "$(pwd)/skills/myanyagent" ~/.config/opencode/skills/myanyagent
```

## 给 agent 的文档

- [docs/agent-setup.md](docs/agent-setup.md) — 完整的
  安装/自检/清单流程，agent 按此执行
- [docs/reference.md](docs/reference.md) — 配置字段、凭据流、
  白名单、全部命令
- [docs/contributing-to-third-party-repos.md](docs/contributing-to-third-party-repos.md)
  — 上游模型背后的调研笔记

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