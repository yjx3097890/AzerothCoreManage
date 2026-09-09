# 架构设计

本文描述 AzerothCore + mod-playerbots 的 Web 管理端（Go + React）。范围仅 **P0 + P1**。World 内容编辑（生物 / 任务 / SmartAI）不做，交给 Keira3。

## 1. 目标与约束

**目标**

- 用网页替代日常 SSH / worldserver 控制台。
- 把 Playerbots 当作一等模块，而不是附加命令。
- 所有被管游戏服都跑在 Docker 里，管理端按「容器 + 网络」对接，不假设 systemd。

**约束**

- AzerothCore 没有官方管理 REST。写入在线世界只能走 SOAP；列表与统计走 MySQL。
- 管理端必须加入游戏服所在的 Docker 网络，用容器名访问 SOAP / MySQL，而不是把 7878 暴露到公网。
- 启停进程 = Docker Engine API（挂载 `docker.sock`），并只允许操作白名单容器。
- 前端改为 **React**（不再使用 Vue）。
- 面板 UI 支持 **中文 / English**，见 [i18n.md](./i18n.md)。

## 2. 逻辑架构

```
浏览器 (React)
    │  HTTPS / JWT
    ▼
管理端 API (Go)
    ├── SOAP Client ──────────► worldserver:7878  executeCommand
    ├── MySQL  ────────────────► acore_auth / acore_characters
    │                            acore_world / acore_playerbots
    ├── Docker SDK ───────────► docker.sock
    │                              启停 / 状态 / logs
    └── Conf Adapter ──────────► 只读/受控写入已挂载的 conf 卷
                                  （worldserver.conf / playerbots.conf）
```

浏览器永不直连 SOAP、MySQL 或 Docker。所有凭证留在 Go 进程内。

## 3. 部署拓扑（Docker）

管理端是**独立 Compose 项目**，通过 **external network** 加入已有 AzerothCore 网络。

```
┌─ 游戏服 Compose（已存在）──────────────────────┐
│  ac-database :3306                              │
│  ac-authserver :3724                             │
│  ac-worldserver :8085  SOAP:7878                 │
│  volumes: etc/  logs/  data/                     │
│  network: ac-network                              │
└─────────────────────────────────────────────────┘
                    ▲ 同一 Docker network
┌─ 管理端 Compose ─────────────────────────────────┐
│  acmanage-api   (Go)  挂载 docker.sock             │
│  acmanage-web   (nginx + React 静态资源)           │
│  可选: acmanage-db（面板用户 / 审计；也可用 SQLite）│
└─────────────────────────────────────────────────┘
```

推荐对接方式：

| 依赖 | 管理端如何访问 | 说明 |
|---|---|---|
| SOAP | `ac-worldserver:7878` | 容器内网；`SOAP.IP=0.0.0.0`，`SOAP.Enabled=1` |
| MySQL | `ac-database:3306` | 四库同实例不同库名 |
| 启停 | Docker socket | 只操作配置里的容器名 |
| 日志 | Docker Logs API | 不必再 SSH `tail`；也可读 logs volume |
| conf | bind mount 游戏服 `etc` 目录 | P1 配置编辑；改完 SOAP `.reload config` 或提示重启容器 |

游戏服 `worldserver.conf` 必须：

```ini
SOAP.Enabled = 1
SOAP.IP = "0.0.0.0"
SOAP.Port = 7878
```

SOAP 账号：GM 3，且 `acore_auth.account_access.RealmID = -1`。

## 4. 多服务器模型

「所有服务器都在 Docker 上」按 **Target（目标服）** 建模，而不是写死一套主机名。

```yaml
targets:
  - id: local
    name: 本机测试服
    docker:
      network: ac-network
      containers:
        worldserver: ac-worldserver
        authserver: ac-authserver
        database: ac-database
    soap:
      host: ac-worldserver
      port: 7878
    mysql:
      host: ac-database
      port: 3306
```

P0 先跑通 **单个 Target**。P1 把 Target 做成可切换（同一套页面，后端按 `X-Target-Id` 选连接池）。不同 Compose 项目只要在同一 Docker Engine 上，就能用容器名 / 网络名区分。

## 5. 后端分层（Go）

```
api/
  cmd/server/          入口
  internal/
    config/            YAML（唯一配置源）
    soap/              SOAP executeCommand
    dockerx/           容器白名单、启停、日志流
    db/                四库连接池
    panel/             面板用户、JWT、RBAC
    audit/             操作审计
    acmd/              命令白名单、二次确认、危险 playerbots 命令拦截
    i18n/              错误码多语言（zh-CN / en-US）
    httpapi/           Gin 路由与 handler
```

**写入规则**

1. 角色 `online=1` → 只能 SOAP，禁止 UPDATE 游戏库。
2. 账号密码 → 只能 SOAP（SRP6），禁止手写 `verifier`。
3. `playerbot rndbot revive` / `grind` → 代码层直接拒绝。
4. 关服、删号、`rndbot reset/init` → 二次确认 + 审计。

## 6. 前端信息架构（React）

文案全部走 `web/src/i18n/locales/{zh-CN,en-US}.json`，组件里只用 `t('...')`。语言切换在登录页和顶栏。

| 路由 | 模块 | 分期 |
|---|---|---|
| `/login` | 面板登录 | P0 |
| `/` | 总览 | P0 |
| `/servers` | 容器状态 / 启停 / 平滑关服 | P0 |
| `/accounts` | 账号 | P0 / P1 |
| `/characters` | 角色 | P0 / P1 |
| `/moderation` | 封禁 / 禁言 | P0 / P1 |
| `/mail` | 邮件发放与查看 | P0 / P1 |
| `/announcements` | 公告 / MOTD / 自动广播 | P0 / P1 |
| `/tickets` | GM 工单 | P0 / P1 |
| `/guilds` | 公会 / 竞技场 / 队伍 | P1 |
| `/auctions` | 拍卖行 | P1 |
| `/events` | 游戏事件 / disable / reload | P1 |
| `/playerbots` | Bot 总览与调度 | P0 / P1 |
| `/logs` | 容器日志 | P0 |
| `/config` | conf 编辑 / 备份 | P1 |
| `/audit` | 操作审计 | P0 |
| `/settings` | SOAP 控制台、Target、白名单 | P1 |

## 7. API 约定

- 前缀：`/api/v1`
- 鉴权：`Authorization: Bearer <jwt>`
- 多服：`X-Target-Id: local`（缺省为配置里的第一个 Target）
- 语言：`X-Locale: zh-CN|en-US`（优先）或 `Accept-Language`
- 统一响应：

```json
{ "ok": true, "data": {}, "error": { "code": "", "message": "" } }
```

`error.code` 为稳定英文码，前端按 code 翻译；`message` 已按请求语言填写，便于 curl。SOAP 原文（命令输出、日志）不翻译。

危险操作使用 `POST` + `{ "confirm": true }`。

模块与路由前缀见 [tasks.md](./tasks.md) 中的任务编号。

## 8. 安全

- 管理端端口只绑本机或内网；前面加反向代理与 HTTPS。
- `docker.sock` 等同 root：容器白名单 + 面板 RBAC（只读 / GM / 超管）。
- SOAP 凭证、数据库密码只出现在服务端配置。
- 审计记录：操作者、Target、命令原文、结果摘要、时间。
- 不把 SOAP 端口映射到 `0.0.0.0` 的公网。容器之间走 `ac-network` 即可。

## 9. 配置

唯一样例环境文件：`.env.example` → `.env`。后端结构见 `api/config.yaml`。

`soap.host` / `mysql.host`：开发填局域网 IP 或 `127.0.0.1`；Compose 部署填容器名。其余字段相同。

## 10. 明确不做（本仓库）

- Keira3 级 World 编辑
- 依赖「当前选中单位」的 GM 命令
- 网页指挥单个 Bot 打本（密语战术 `co/nc`）
- 编译核心、安装模块（原调研 P2）
- 多 Docker Engine / 远程 SSH 集群（需要时再扩展；当前假设一块 Docker Engine）
