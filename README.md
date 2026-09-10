# AzerothCore Manage

[English](README.en.md) | 简体中文

面向 **AzerothCore**（含 **mod-playerbots**）的 Web 管理面板：用浏览器完成日常运维，减少 SSH 与 worldserver 控制台操作。

技术栈：**Go（Gin）+ React（Vite / Tailwind CSS / DaisyUI）**，通过 SOAP 发指令、MySQL 查四库，可选对接 Docker 管理容器。

> 本项目采用**商用收费许可**：个人非商业使用见 [LICENSE](LICENSE)；**任何商业用途须另行购买授权**。

## 功能概览

| 模块 | 能力 |
|------|------|
| 总览 | 在线人数、uptime、真实玩家 / Bot 拆分、健康检查 |
| 容器 | 白名单容器启停 / 重启 / 日志（可关 Docker） |
| 账号 / 角色 | 列表检索、GM、改密、踢人、传送、物品邮件、库存等 |
| 处罚 / 邮件 / 公告 | ban、禁言、邮件、每日消息（多语言 locale）、自动广播 |
| 公会 / 竞技场 / 拍卖 | 浏览与常用管理；拍卖行当前以浏览为主 |
| 世界事件 / 禁用项 | 启停事件；disables 列表本地化展示 |
| Playerbots | 概览、在线 Bot、rndbot、配置项、公会等 |
| 模块（P2-A） | 精选 / 官网目录、已装扫描、GitHub 登记、DeepSeek 兼容评估、模块 conf（**不执行安装**） |
| 配置 / 备份 / SQL / 审计 | conf 编辑、备份、只读 SQL 浏览、操作审计 |
| 多语言 | 面板 UI 中 / 英；游戏地名、职业、禁用原因等跟随语言；**评估文案随界面语言** |

详细任务与进度见 [docs/tasks.md](docs/tasks.md)，架构见 [docs/architecture.md](docs/architecture.md)。模块管理方案见 [docs/module-manager.md](docs/module-manager.md)。

## 模块管理（已实现 P2-A）

侧栏进入 **模块**（`/modules`）。当前阶段只做**浏览与评估**，不会 clone、编译或改你的服。

| 能力 | 说明 |
|------|------|
| 精选目录 | 本地 `api/data/modules/curated.json`（中文名 / 摘要）；缺日期时用 GitHub 补 `pushed_at` 与星数。Docker 镜像会打进该文件，compose 也挂载同路径，改完刷新即可 |
| 官网目录 | [AzerothCore catalogue](https://www.azerothcore.org/data/catalogue.json) 中带 `azerothcore-module` 的仓库 |
| 列表排序 | 表头可按名称、仓库、**最后提交**、**★**、来源等排序 |
| 已安装 | 扫描 `AC_ROOT/modules` + `modules.list`；SOAP `server debug` 判断是否已加载（**API 进程必须能读到该路径**；Docker 部署需挂载，见 `docker-compose.yml`） |
| 自定义登记 | 粘贴 GitHub 地址加入评估列表（超管） |
| AI 评估 | 拉取 README / `acore-module.json` / Issues，DeepSeek + 规则给出兼容分、功能说明、建议与风险 |
| 模块 conf | `etc/modules/*.conf` 可在模块页或配置页编辑 |

**本机核心版本**探测顺序：SOAP `server info` → `AC_ROOT` git → `.env` 保底：

```bash
AC_CORE_VERSION=AzerothCore rev. 413bea61a85e+ …
AC_CORE_REVISION=413bea61a85e
```

评估相关可选配置：

```bash
MODULES_DEPLOY=docker          # docker | source，影响评估里的部署语境
DEEPSEEK_API_KEY=              # 未配置则仅规则评估
DEEPSEEK_BASE_URL=https://api.deepseek.com   # OpenAI 兼容；请求发往 {BASE}/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
GITHUB_TOKEN=                  # 提高 GitHub API 限额（公开库只读即可）
```

评估客户端走 **OpenAI Chat Completions** 协议（`/chat/completions` + JSON Mode）。  
因此凡兼容该接口的服务一般都能用：官方 DeepSeek、OpenAI（`https://api.openai.com/v1`）、以及多数本地 / 第三方兼容网关。按对方文档改 `DEEPSEEK_BASE_URL` 与 `DEEPSEEK_MODEL` / Key 即可；对方若要求路径带 `/v1`，把 `/v1` 写进 Base URL。

后续 **P2-B 检查点回退**、**P2-C 安装编排**尚未开放，见方案文档。

## 快速开始

### 1. 配置

后端结构在 `api/config.yaml`（可提交）；敏感项与机器路径在仓库根目录 `.env`（gitignore）：

```bash
cp .env.example .env
# 编辑 .env：AC_ROOT、端口、账号、SOAP/MySQL
```

`api/config.yaml` 支持 `${VAR}`；API 会加载根目录 `.env` 并展开。  
Docker Compose 使用同一份 `.env`（端口、volume、外部网络）。

- **本机开发**：`.env` 里 SOAP/MySQL 填游戏服 IP
- **同机 Docker**：可改为容器名，并保证 `AC_NETWORK` 与游戏服网络一致

游戏服需开启 SOAP，例如：

```ini
SOAP.Enabled = 1
SOAP.IP = "0.0.0.0"
SOAP.Port = 7878
```

### 2. 本机开发

```bash
make api   # API 默认 :8080
make web   # 前端默认 :5173
```

- 前端：http://localhost:5173  
- API：http://localhost:8080（Vite 开发代理会转发 `/api`）

浏览器打开前端地址，使用 `.env` 里 `PANEL_ADMIN_*` 登录。

### 3. Docker 部署

```bash
docker compose up -d --build
```

- 面板：http://localhost:${ACMANAGE_WEB_PORT:-8086}（默认 8086）  
- API 不单独对外暴露，由 web 容器内 nginx 反代 `/api/`  
- 日志：仓库 `logs/`（compose 挂载）/ 容器内也可写 `api/logs/`

## 技术选型

| 层 | 选型 |
|----|------|
| 前端 | React + TypeScript + Vite + Tailwind CSS + DaisyUI + i18next |
| 后端 | Go + Gin + JWT RBAC（只读 / GM / 超管） |
| 指令 | SOAP `executeCommand`（白名单） |
| 数据 | MySQL：auth / characters / world / playerbots |
| 进程 | Docker Engine API（可选，容器白名单） |

浏览器**不直连** SOAP、MySQL 或 Docker；凭证只留在 API 进程内。

## 文档

- [架构设计](docs/architecture.md)
- [任务列表](docs/tasks.md)
- [模块管理方案（P2）](docs/module-manager.md)
- [国际化说明](docs/i18n.md)
- [English README](README.en.md)

## 许可与商用

本软件版权归作者所有，详见根目录 [LICENSE](LICENSE)。

| 用途 | 是否允许 |
|------|----------|
| 个人学习、评估、非营利私人服 | 允许（须遵守 LICENSE） |
| 收费托管、售卖面板、营收向商业服、二次商业分发等 | **禁止**，须购买商业授权 |

商用授权、OEM / 多开 / 贴牌等请邮件联系：**315644588@qq.com**。

**免责声明**：本软件与 Blizzard Entertainment、AzerothCore 官方无隶属关系；请遵守当地法律及游戏相关服务条款。软件按「现状」提供，作者不对使用后果承担责任。
