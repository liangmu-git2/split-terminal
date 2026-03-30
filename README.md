# Split Terminal

多分屏终端管理器 - Electron based multi-pane terminal manager

## 下载

### GitHub Release

[前往 GitHub Releases 下载](https://github.com/liangmu-git2/split-terminal/releases/latest)

### 国内加速下载

如果 GitHub 下载速度慢，可使用以下加速链接：

**Windows (.exe)**
- [加速下载 - ghproxy](https://mirror.ghproxy.com/https://github.com/liangmu-git2/split-terminal/releases/download/v1.6.0/Split.Terminal.Setup.1.6.0.exe)
- [加速下载 - 99988866](https://gh.api.99988866.xyz/https://github.com/liangmu-git2/split-terminal/releases/download/v1.6.0/Split.Terminal.Setup.1.6.0.exe)

**macOS (Intel)**
- [加速下载 - ghproxy](https://mirror.ghproxy.com/https://github.com/liangmu-git2/split-terminal/releases/download/v1.6.0/Split.Terminal-1.6.0.dmg)
- [加速下载 - 99988866](https://gh.api.99988866.xyz/https://github.com/liangmu-git2/split-terminal/releases/download/v1.6.0/Split.Terminal-1.6.0.dmg)

**macOS (Apple Silicon)**
- [加速下载 - ghproxy](https://mirror.ghproxy.com/https://github.com/liangmu-git2/split-terminal/releases/download/v1.6.0/Split.Terminal-1.6.0-arm64.dmg)
- [加速下载 - 99988866](https://gh.api.99988866.xyz/https://github.com/liangmu-git2/split-terminal/releases/download/v1.6.0/Split.Terminal-1.6.0-arm64.dmg)

> 加速链接的原理是在 GitHub 下载地址前加代理前缀，如果某个加速服务不可用，可尝试另一个。

## 维护者说明

### 可选：发版后自动同步到 Gitee

当前仓库已支持在 GitHub Release 成功后，自动把源码、tag 和安装包同步到 Gitee Release。

需要提前在 GitHub 仓库里配置以下 Actions 凭据：

- `Secret`: `GITEE_ACCESS_TOKEN`
- `Variable`: `GITEE_OWNER`
- `Variable`: `GITEE_REPO`

同步行为：

- 推送 `main` 分支到 Gitee
- 推送当前发布 tag 到 Gitee
- 在 Gitee 创建或更新同名 Release
- 上传 `.exe`、`.dmg`、`latest.yml`、`blockmap` 等发布产物
- 超过 `100 MiB` 的单个附件会自动跳过，避免整条同步任务失败

建议：

- 先在 Gitee 手动创建同名仓库
- Gitee 默认分支使用 `main`
- Intel 版 macOS 安装包如果超过 `100 MiB`，通常不会出现在 Gitee Release 附件里
- 自动同步失败时，不影响 GitHub Release 主流程
