<!-- Source: Best-README-Template BLANK_README (Unlicense) — https://github.com/othneildrew/Best-README-Template -->
<a id="readme-top"></a>

# MyAnyAgent

MyAnyAgent authenticates an AI coding agent to GitHub through short-lived, repository-scoped GitHub App installation tokens instead of a password or personal access token, and can attach an AI-authorship trailer to every commit it creates.

**English** · [简体中文](README.zh-CN.md)

[![CI](https://github.com/anyingiit/myanyagent/actions/workflows/ci.yml/badge.svg)](https://github.com/anyingiit/myanyagent/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/anyingiit/myanyagent)](LICENSE)

[Report a bug](https://github.com/anyingiit/myanyagent/issues/new?template=bug_report.yml) · [Request a feature](https://github.com/anyingiit/myanyagent/issues/new?template=feature_request.yml)

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#about-the-project">About The Project</a></li>
    <li><a href="#getting-started">Getting Started</a></li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
  </ol>
</details>

## About The Project

MyAnyAgent lets an AI coding agent push commits and open pull requests to GitHub without ever holding your password or minting its own long-lived token. A git credential helper (`bin/myanyagent-credential-helper.cjs`) signs a GitHub App JWT and mints a fresh, repository-scoped installation token on every `git push` or `git fetch`, so the token in play is always short-lived and never stored. A separate, allowlisted adapter (`bin/myanyagent-upstream.cjs`) covers forking a third-party repository, opening a pull request against it, and commenting on its issues, and defaults to a dry run until you approve the write. Every commit made through the tool carries a `Co-authored-by:` trailer disclosing AI involvement, added by a `prepare-commit-msg` hook rather than left to habit.

See the [open issues](https://github.com/anyingiit/myanyagent/issues) for planned features and known issues.

## Getting Started

### Prerequisites

- Git
- Node.js 18 or newer — both `install.sh` and `bin/myanyagent-bootstrap.sh` refuse to run without it
- A GitHub App you register yourself, with its private key saved somewhere only you can read (the one browser-based step; see Installation below)

### Installation

```sh
git clone https://github.com/anyingiit/myanyagent.git
cd myanyagent
sh install.sh
```

`install.sh` installs the tool to `~/.local/share/myanyagent`, symlinks its commands into `~/.local/bin`, and writes a placeholder config to `~/.config/myanyagent/config.toml`. Filling that config needs a GitHub App you register yourself:

1. Register a GitHub App on your account, granting it **Contents: Read and write** and no webhook.
2. Generate its private key from the App's settings page and save the `.pem` file with mode `0600`.
3. Install the App on your own account, selecting the repositories it may touch.
4. Set `client_id`, `app_id` and `private_key` in `~/.config/myanyagent/config.toml` to the values from steps 1–3.
5. In each of those repositories, create a `.myanyagent.toml` (`config/config.template.toml` and `docs/reference.md` show the fields), then run `myanyagent-bootstrap`.

## Usage

```sh
myanyagent-status
```

reports whether the machine config, the private key, and the current repository's git configuration are ready, and names the exact next command when something is not — `myanyagent-bootstrap` to configure a repository, or `sh install.sh` if the tool itself is missing. Once a repository is bootstrapped, `git push` and `git fetch` over HTTPS authenticate through the installation token automatically; `docs/reference.md` covers `myanyagent-upstream` and the rest of the per-repository configuration.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for how to open an issue or a pull request, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the standards expected of everyone taking part.

Please do not report security issues in public issues or pull requests. [SECURITY.md](SECURITY.md) explains how to report them privately.

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

## Contact

Project link: [https://github.com/anyingiit/myanyagent](https://github.com/anyingiit/myanyagent)

<p align="right">(<a href="#readme-top">back to top</a>)</p>
