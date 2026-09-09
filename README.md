# AzerothCore Manage

[English](README.en.md) | 简体中文

面向 **AzerothCore**（含 **mod-playerbots**）的 Web 管理面板：用浏览器完成日常运维，减少 SSH 与 worldserver 控制台操作。

技术栈：**Go（Gin）+ React（Vite / Ant Design）**，通过 SOAP 发指令、MySQL 查四库，可选对接 Docker 管理容器。

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
| 配置 / 备份 / SQL / 审计 | conf 编辑、备份、只读 SQL 浏览、操作审计 |
| 多语言 | 面板 UI 中 / 英；游戏地名、职业、禁用原因等跟随语言 |

详细任务与进度见 [docs/tasks.md](docs/tasks.md)，架构见 [docs/architecture.md](docs/architecture.md)。

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
| 前端 | React + TypeScript + Vite + Ant Design + i18next |
| 后端 | Go + Gin + JWT RBAC（只读 / GM / 超管） |
| 指令 | SOAP `executeCommand`（白名单） |
| 数据 | MySQL：auth / characters / world / playerbots |
| 进程 | Docker Engine API（可选，容器白名单） |

浏览器**不直连** SOAP、MySQL 或 Docker；凭证只留在 API 进程内。

## 文档

- [架构设计](docs/architecture.md)
- [任务列表](docs/tasks.md)
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
