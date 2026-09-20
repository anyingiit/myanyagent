[English](README.md) · **简体中文**

> 英文版是规范版本。本页与 [README.md](README.md) 不一致时，以英文版为准。

<!-- translation-of: README.md sha256:1f80f13c93e69db6 -->

<!-- Source: Best-README-Template BLANK_README (Unlicense) — https://github.com/othneildrew/Best-README-Template -->
<a id="readme-top"></a>

# MyAnyAgent

MyAnyAgent 通过短时效、仅限单个仓库的 GitHub App 安装令牌，让 AI 编程 agent 完成 GitHub 身份认证，而不必使用密码或个人访问令牌；它还能为 agent 创建的每个提交自动附加 AI 署名 trailer。

[![CI](https://github.com/anyingiit/myanyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/anyingiit/myanyagent/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/anyingiit/myanyagent)](LICENSE)

[报告问题](https://github.com/anyingiit/myanyagent/issues/new?template=bug_report.yml) · [提出需求](https://github.com/anyingiit/myanyagent/issues/new?template=feature_request.yml)

<details>
  <summary>目录</summary>
  <ol>
    <li><a href="#about-the-project">关于本项目</a></li>
    <li><a href="#getting-started">开始使用</a></li>
    <li><a href="#usage">用法</a></li>
    <li><a href="#contributing">参与贡献</a></li>
    <li><a href="#license">许可证</a></li>
    <li><a href="#contact">联系方式</a></li>
  </ol>
</details>

## 关于本项目

MyAnyAgent 让 AI 编程 agent 能够向 GitHub 推送提交、开启 pull request，而 agent 本身从不持有你的密码，也不会自己签发长期有效的令牌。仓库里的一个 git 凭据助手（`bin/myanyagent-credential-helper.cjs`）会在每次 `git push` 或 `git fetch` 时签发一个 GitHub App JWT，再据此换取一个刚生成、仅限该仓库、短时效的安装令牌，因此在用的令牌永远是短命的，也从不落盘保存。另一个独立的、白名单限定的适配器（`bin/myanyagent-upstream.cjs`）负责 fork 第三方仓库、向其开启 pull request、在其 issue 下评论，且默认先演练（dry run），等你确认后才真正写入。`prepare-commit-msg` 钩子会自动添加 `Co-authored-by:` trailer 以披露 AI 参与情况，而不是靠自觉；但它会跳过 merge、squash 以及复用信息的提交，遇到缺少 Node.js、缺少 `.myanyagent.toml`，或仓库里已经存在别的钩子这几种情况时，也不会做任何事。

计划中的功能与已知问题，见 [open issues](https://github.com/anyingiit/myanyagent/issues)。

## 开始使用

### 环境要求

- Git
- Node.js 18 或更高版本——`install.sh` 与 `bin/myanyagent-bootstrap.sh` 都只检查 `PATH` 上有没有 `node` 可执行文件，不检查版本，所以旧版本不会被拒绝，但也不受支持
- 一个你自己注册的 GitHub App，其私钥需保存在只有你能读取的位置（唯一需要打开浏览器完成的一步；见下方"安装"）

### 安装

```sh
git clone https://github.com/anyingiit/myanyagent.git
cd myanyagent
sh install.sh
```

`install.sh` 会把工具安装到 `~/.local/share/myanyagent`，把它的命令软链接到 `~/.local/bin`，并写出一份占位配置到 `~/.config/myanyagent/config.toml`。填好这份配置需要一个你自己注册的 GitHub App：

1. 在你的账号下注册一个 GitHub App，权限只勾选 **Contents: Read and write**，webhook 保持关闭。
2. 在该 App 的设置页生成私钥，把下载到的 `.pem` 文件以 `0600` 权限保存好。
3. 把该 App 安装到你自己的账号，勾选它可以访问的仓库。
4. 用第 1–3 步得到的值，填好 `~/.config/myanyagent/config.toml` 里的 `client_id`、`app_id` 和 `private_key`。
5. 在每个这样的仓库里创建 `.myanyagent.toml`（字段说明见 `config/config.template.toml` 与 `docs/reference.md`），然后运行 `myanyagent-bootstrap`。

## 用法

```sh
myanyagent-status
```

会报告机器级配置、私钥、以及当前仓库的 git 配置是否就绪；只要有一项没就绪，就会提示一个下一步命令——工具本身尚未安装时是 `sh install.sh`，其余情况是 `myanyagent-bootstrap`；但如果 `.myanyagent.toml` 还不存在，请先创建它（见"安装"第 5 步），因为 `myanyagent-bootstrap` 要求这个文件已经存在，而不会替你创建它。仓库一旦完成 bootstrap，后续通过 HTTPS 的 `git push` 和 `git fetch` 就会自动用安装令牌完成认证；`myanyagent-upstream` 以及其余的按仓库配置细节见 `docs/reference.md`。

## 参与贡献

欢迎参与。[CONTRIBUTING.md](CONTRIBUTING.md) 说明如何提交 issue 或 pull request，[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 说明对所有参与者的行为要求。

请不要在公开的 issue 或 pull request 中报告安全问题。[SECURITY.md](SECURITY.md) 说明了私下报告的方式。

## 许可证

以 MIT 许可证分发。详见 [LICENSE](LICENSE)。

## 联系方式

项目地址：[https://github.com/anyingiit/myanyagent](https://github.com/anyingiit/myanyagent)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
