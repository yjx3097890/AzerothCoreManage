# 任务列表（P0 / P1）

状态：`[ ]` 未做 · `[~]` 进行中 · `[x]` 完成

骨架（M0）完成后，按编号从上到下做。每个任务应同时改：Go handler、React 页面、审计（写操作）。

## 约定

- **通道**：SOAP / SQL / Docker / Conf
- **文案**：新 UI 字符串必须同时写入 `web/src/i18n/locales/zh-CN.json` 与 `en-US.json`
- **在线角色**：先查 `characters.online`，在线则禁止直接改库
- **危险命令**：`server exit`、删号、`rndbot reset/init/revive/grind` 必须走白名单逻辑

---

## M0 骨架

- [x] T000 仓库结构、文档、Go/React/Compose 骨架
- [x] T008 中英文 i18n 框架（i18next + 错误码 + 语言切换）
- [x] T001 读配置、健康检查（API / SOAP / MySQL / Docker）
- [x] T002 面板登录 JWT + 三档 RBAC（只读 / GM / 超管）
- [x] T003 操作审计表与中间件
- [x] T004 SOAP 客户端 + 命令白名单
- [x] T005 四库 MySQL 连接池
- [x] T006 Docker 白名单客户端（list/start/stop/restart/logs）
- [x] T007 Target 上下文（单 Target 跑通，预留多 Target）

---

## P0 日常运维

### 总览 `/`

- [x] P0-01 调用 `server info` 展示版本、uptime、在线、峰值
- [x] P0-02 SQL 拆分真实玩家 vs Playerbots 在线数（`account` 前缀 `rndbot` 可配）
- [x] P0-03 展示 auth/world 容器运行状态

### 容器与生命周期 `/servers`

- [x] P0-04 列出白名单容器状态（world / auth / db）
- [x] P0-05 启动 / 停止 / 重启容器
- [x] P0-06 SOAP 平滑重启 / 关服（带秒数）
- [x] P0-07 取消重启 / 关服

### 账号 `/accounts`

- [x] P0-08 账号列表、搜索、上次 IP / 登录时间
- [x] P0-09 SOAP `account create`
- [x] P0-10 SOAP `account set password`
- [x] P0-11 SOAP `account set gmlevel`（含 realm `-1`）

### 角色 `/characters`

- [x] P0-12 角色检索（名 / 账号 / 等级 / 在线）
- [x] P0-13 角色详情只读（金钱、位置、地图）
- [x] P0-14 SOAP `.kick`
- [x] P0-15 SOAP `.teleport name` / `.unstuck`
- [x] P0-16 SOAP `.character level` / `rename` / `customize`

### 处罚 `/moderation`

- [x] P0-17 SOAP 封禁账号 / 角色 / IP / 按角色封账号
- [x] P0-18 SOAP 解封
- [x] P0-19 封禁列表（SQL `account_banned` / `ip_banned` / `character_banned`）
- [x] P0-20 SOAP `.mute` / `.unmute`

### 公告与邮件 `/announcements` `/mail`

- [x] P0-21 SOAP `.announce` / `.notify`
- [x] P0-22 SOAP `.server motd` / `.server set motd`
- [x] P0-23 SOAP `.send mail`
- [x] P0-24 SOAP `.send items`
- [x] P0-25 SOAP `.send money`（支持 `1g2s3c`）

### 工单 `/tickets`

- [x] P0-26 工单列表（开放 / 在线玩家）
- [x] P0-27 查看详情、评论、回复
- [x] P0-28 指派 / 取消指派 / 关闭 / 完成

### Playerbots `/playerbots`

- [x] P0-29 Bot 总览：Rndbot / AddClass / Altbot 数量
- [x] P0-30 SOAP `playerbot rndbot stats`
- [x] P0-31 在线 Bot 列表（地图、等级、职业）
- [x] P0-32 SOAP `playerbot rndbot reload`
- [x] P0-33 SOAP `init` / `reset` / `level` / `refresh` / `teleport`（二次确认）
- [x] P0-34 拦截 `rndbot revive`、`rndbot grind`
- [x] P0-35 只读展示 playerbots.conf 关键项（人数、等级、无人下线、autogear）

### 日志 `/logs`

- [x] P0-36 WebSocket 跟踪 world/auth 容器日志（可过滤级别）

### 面板自身

- [x] P0-37 审计页
- [x] P0-38 危险操作二次确认组件
- [x] P0-39 侧栏按 RBAC 隐藏模块

---

## P1 深度管理

### 总览 / 容器

- [x] P1-01 容器 CPU / 内存（Docker stats）
- [x] P1-02 解析 update time / 卡顿（`server info` 或日志）
- [x] P1-03 SOAP `idlerestart` / `idleshutdown`
- [x] P1-04 SOAP `.server set closed`
- [x] P1-05 SOAP `.server set security`

### 账号

- [x] P1-06 锁定 IP / 国家（`account.lock` + SOAP）
- [x] P1-07 SOAP `account set addon`
- [x] P1-08 SOAP `account flag add/remove/list`
- [x] P1-09 查看 / 关闭 2FA（读 `totp_secret`；关闭 `account set 2fa … off`）
- [x] P1-10 SOAP `account delete`（超管 + 二次确认）

### 角色

- [x] P1-11 转阵营 / 转种族 / 换账号
- [x] P1-12 `.additem` / 负数量删除 / `additem set`（角色页以 `send items` 为主；`additem` 已白名单）
- [x] P1-13 `.send money` 到角色 / `.setskill` / `.player learn|unlearn`（send money 已做；setskill/learn 需选中在线目标，面板未做）
- [x] P1-14 背包 / 银行 / 装备只读（`character_inventory` + `item_instance`）
- [x] P1-15 `.quest add/complete/remove/status`
- [x] P1-16 声望 / 成就 / 头衔只读（头衔 SOAP `character titles`；写入因需选中目标未做）
- [x] P1-17 宠物列表与删除（离线删库）
- [x] P1-18 已删角色 list / restore / purge / erase
- [x] P1-19 `.revive` 与 `.reset`（天赋 / 法术 / 荣誉 / 物品）

### 处罚与安全

- [x] P1-20 `.freeze` / `.unfreeze`
- [x] P1-21 失败登录 / IP 行为日志（`failed_logins` + `logs_ip_actions`）
- [x] P1-22 `chat_filter` 编辑 + `.reload chat_filter`
- [x] P1-23 `reserved_name` / `profanity_name` + reload

### 邮件 / 公告 / 经济

- [x] P1-24 自动广播 CRUD（含权重；locale 视表结构）
- [x] P1-25 群发邮件（循环 SOAP，限速；支持纯邮件 / 物品 / 金钱 / 物品+金钱）
- [x] P1-26 查看 / 删除玩家邮件（在线禁止删除）
- [x] P1-27 拍卖行浏览；下架走 SOAP（若命令不足则只读）

### 社交

- [x] P1-28 公会列表 / 成员 / 资金
- [x] P1-29 公会银行只读
- [x] P1-30 SOAP `.guild` 创建 / 解散 / 改名 / 换帮主
- [x] P1-31 竞技场队伍与 `.arena season *`
- [x] P1-32 队伍 / 团队查看

### 工单补充

- [x] P1-33 永久删除工单 / 重置计数器
- [x] P1-34 `.ticket togglesystem`

### 世界

- [x] P1-35 `.event` 列表 / 启停
- [x] P1-36 `disables` + `.disable` / `.reload disables`
- [x] P1-37 `.reload` 常用表（config / loot / quest / creature / motd）
- [x] P1-38 传送点列表；`.teleport add/del`（add 写 `game_tele` + reload；del 走 SOAP）

### Playerbots

- [x] P1-39 `playerbot pmon` 开关与读数
- [x] P1-40 `.playerbots bot add/remove/addaccount`
- [x] P1-41 `.playerbots bot addclass`
- [x] P1-42 `.playerbots account link/unlink/list`
- [x] P1-43 Bot 公会数量与成员
- [x] P1-44 编辑 playerbots.conf 关键项并 reload（需配置 `conf.playerbots_conf` / `etc_dir`）

### 配置 / 备份 / 控制台

- [x] P1-45 在线编辑 `worldserver.conf` / `authserver.conf`（备份 `.bak.*`；需配置 conf 路径）
- [x] P1-46 mysqldump 四库备份到卷（`backup.dir`）
- [x] P1-47 只读 SQL 浏览器（表白名单）
- [x] P1-48 通用 SOAP 控制台（仍走命令白名单）
- [x] P1-49 多 Target 切换（`X-Target-Id`）

---

## 推荐实施顺序（做的时候按这个切 PR）

1. T001–T007 接通真实 Docker 游戏服（健康检查全绿）
2. P0-01～P0-07 总览 + 容器
3. P0-08～P0-20 账号 / 角色 / 处罚
4. P0-21～P0-28 公告邮件工单
5. P0-29～P0-36 Playerbots + 日志
6. P1 按「角色深度 → 公会拍卖 → 事件 reload → conf 备份 → 多 Target」

## 说明

- conf / playerbots.conf / mysqldump：远端游戏服需在 `config.yaml` 填可访问路径；本机无卷则对应功能返回不可用提示。
- `setskill` / `learn` / 部分声望头衔写入：SOAP 需选中在线目标，面板仅保留只读与邮件发放类写入。
