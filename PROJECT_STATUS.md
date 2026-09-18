# myanyagent 状态总结

> 本文件由 #WORKSPACE_MANAGEMENT 生成于 2026-09-18（主机：HOST_REDACTED）。可以自由补充修改；
> 以后自动更新时，只会追加缺失或需要补充的章节，不会覆盖已有内容。

## 用途

MyAnyAgent 让用户的 AI agent 代替用户向 GitHub 推送代码、管理 PR 和 issue，用户本人不需要处理密码或 token（依据 README）。
目标用户是希望把 GitHub 相关的日常操作交给 AI agent 完成、又不想自己保管凭据的开发者。

## 技术栈

- 语言与框架：Node.js 与 Shell 脚本（依据测试命令 `node --test *.cjs` 与 `sh *.sh`；未发现明确的框架声明文件）
- 主要依赖：未知（本次盘点未发现依赖清单文件，manifest_files 为空）

## 运行方式

根据 README：用户不需要自己安装，只需让 AI agent 执行“Install myanyagent on this machine”，由 agent 完成整个安装流程。
安装过程中，agent 会请用户在浏览器完成一次性检查清单：注册 GitHub App、生成私钥、并把该 App 安装到自己的账号，
随后用户把 App 的相关标识信息和私钥文件交回给 agent（外部条件：需要一个 GitHub 账号；本文件不记录任何真实凭据）。

验证/测试命令（与本次可运行性检查一致）：

```sh
node --test test/helper.test.cjs
node --test test/upstream.test.cjs
node --test test/attribution.test.cjs
sh test/hooks.test.sh
sh test/bootstrap.test.sh
sh test/status.test.sh
sh test/install.test.sh
```

## 当前状态

可运行性：可运行
评估日期：2026-09-18

- 检查方式：tests，关键命令：`node --test test/helper.test.cjs` 等 7 条验证命令（role=verify），退出码均为 0
- 最近提交：2026-09-02 feat(myanyagent): human-first onboarding — agent-driven install with one-time browser checklist

## 已知问题与下一步

- 首次使用前需要人工完成 README 中的一次性浏览器检查清单（注册 GitHub App、生成私钥、安装该 App），wsm 的可运行性检查不覆盖这一步，需使用者自行确认已完成。
- 本次盘点未发现依赖清单文件（如 package.json），建议后续补充，便于追踪依赖版本。
- 本文件为首次生成（此前项目内没有 PROJECT_STATUS.md），建议维护者后续人工审阅并补充运维细节。
