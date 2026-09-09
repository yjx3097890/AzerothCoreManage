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

只维护一份 `config.yaml`（已 gitignore），不要用 `.env` 重复配凭证：

```bash
cp config.example.yaml config.yaml
# 编辑 panel / soap / mysql / docker
```

- **本机开发**：`soap.host`、`mysql.host` 填游戏服 IP（或本机映射地址）
- **同机 Docker**：可改为容器名，并加入游戏服网络；`docker.enabled` 按需开启

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

浏览器打开前端地址，使用 `config.yaml` 里 `panel.admin_*` 登录。

### 3. Docker 部署

```bash
docker compose up -d --build
```

- 前端：http://localhost:5174  
- API：http://localhost:8080  
- 日志：本机 `api/logs/`（Compose 下也可挂到仓库 `logs/`）

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
