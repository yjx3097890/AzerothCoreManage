# P2 模块管理方案

本文把此前讨论收敛成可实施设计：**目录与 GitHub 登记、DeepSeek 评估（含本机已装版本与仓库 Issues）、检查点备份、安装/卸载/整包回退、模块 conf 编辑**。

**P2-A（目录与评估）已实现**；P2-B / P2-C 仍为设计。架构总览仍以 [architecture.md](./architecture.md) 为准。

相关图：

- [架构图](./diagrams/module-manager-architecture.svg)
- [安装与回退流程](./diagrams/module-install-flow.svg)
- [AI 评估数据流](./diagrams/module-evaluate-flow.svg)

---

## 1. 目标与原则

**目标**

- 用网页完成「找模块 → 看风险 → 装/卸 → 改配置 → 出问题整包倒回」，减少 SSH。
- AI 只做**带证据的顾问**，不执行 clone / 编译 / 改库。
- 回退承诺是：**回到安装前检查点**，不是「保证编得过」或「按模块干净拆 SQL」。

**原则**

1. 先检索、再问模型。没有 README / `acore-module.json` / Issues 时，结论上限为 `caution`，禁止靠模型记忆编步骤。
2. 安装前必须打**检查点包**（镜像或二进制 + 四库 dump + `modules.list` + 相关 conf）。回退四样一起回。
3. 编译失败通常不必回退（旧进程还在）。回退用于：新镜像已切换、SQL 已执行、新进程起来后行为异常。
4. 任意 GitHub URL = 在游戏服编译陌生 C++。仅超管 + 二次确认 + owner 白名单（可配）。
5. 文案必须写清：回退会丢掉检查点之后的玩家进度；卸载代码 ≠ 撤销 SQL。

**明确不做**

- 运行时热加载 C++ 模块（AC 做不到）。
- 按模块生成反向 migration。
- 保证两个模块 hook 不冲突、保证一定编过。
- 自动给客户端打补丁。
- 让 DeepSeek 直接跑 shell。

---

## 2. 能力分层

| 期 | 用户能做什么 | 技术要点 |
|---|---|---|
| **P2-A 目录与评估** | 浏览常用模块、粘贴 GitHub、看已装与版本、AI 评估、改 `etc/modules/*.conf` | 不 clone 到游戏服；不编译 |
| **P2-B 检查点** | 一键打快照、列表、保留策略 | 复用现有 mysqldump；Docker 给当前 world 镜像打 tag |
| **P2-C 安装编排** | 超管确认后 clone → 重建 → 启停 → 健康检查；失败整包回退 | 异步 Job + 日志流 |

P2-A 可独立上线。P2-C 依赖 P2-B。评估接口在三期都用同一套。

---

## 3. 逻辑架构

```
浏览器 /modules
    │  JWT + X-Target-Id
    ▼
管理端 API
    ├── Module Inventory ──► AC_ROOT/modules、conf/modules.list、git 元数据
    ├── Catalogue ─────────► azerothcore.org/data/catalogue.json
    ├── GitHub Client ─────► README、acore-module.json、Issues、tree
    ├── DeepSeek Client ───► JSON Mode 评估（只吃检索包）
    ├── Rule Overlay ──────► 覆盖模型 verdict（版本/白名单/证据不足）
    ├── Checkpoint ────────► 镜像 tag + mysqldump + 文件副本
    ├── Job Runner ────────► clone / compose build / 启停 / 回退
    ├── Conf Adapter ──────► etc/modules/*.conf（现有 conf 编辑的扩展）
    ├── SOAP ──────────────► server info、server debug、reload config
    └── Docker ────────────► 白名单容器 + 镜像 tag（扩展现有 dockerx）
```

浏览器不直连 GitHub、DeepSeek、Docker、MySQL。密钥只留在 API 进程。

与现有分层的对应：

| 现有 | 模块管理如何复用 |
|---|---|
| `ops_config.go` conf 读写 / `.bak` | 扩展扫描 `etc_modules_dir` |
| `POST /backup` 四库 dump | 检查点 SQL 半边 |
| Docker 启停 / logs WS | Job 日志、重建后重启 |
| SOAP 白名单 + 审计 + 二次确认 | 安装/回退同一套 |
| `parseServerInfo` | 评估上下文里的核心版本 |
| RBAC 超管 | 写操作；GM 只读评估 |

---

## 4. 路径与部署假设

面板已经用 `AC_ROOT` 挂游戏服树。模块管理在 Target 上增加路径（均可覆盖）：

| 配置 | 默认 | 用途 |
|---|---|---|
| `modules.ac_root` | `${AC_ROOT}` | 源码根 |
| `modules.modules_dir` | `${AC_ROOT}/modules` | clone 目标（扁平目录） |
| `modules.modules_list` | `${AC_ROOT}/conf/modules.list` | 官方 installer 清单 |
| `modules.etc_modules_dir` | `${AC_ROOT}/docker/vol/etc/modules` | 运行时模块 conf |
| `modules.deploy` | `docker` \| `source` | 重建方式 |
| `modules.compose_dir` | `${AC_ROOT}` | `docker compose build` 工作目录 |
| `modules.world_image` | 当前 world 容器的 Image | 打检查点 tag 的源 |
| `modules.checkpoint_dir` | `data/module-checkpoints` | 检查点元数据与 SQL |
| `modules.job_dir` | `data/module-jobs` | Job 状态与日志（文件，与 audit 同类） |

Docker 模式：**不要从容器里拷 `worldserver` 当备份**。检查点记录并 tag 当前镜像，例如 `acmanage-ckpt-<id>`。

源码模式：备份 `env/dist/bin/worldserver`（及同目录依赖 `.so`，若有）。

若 `modules_dir` 对 API 进程不可写，P2-A 仍可评估；P2-C 返回 `modules_path_unavailable`。

---

## 5. 本机库存（必须送给 AI）

评估和列表都依赖同一套 Inventory，按模块目录聚合。

每个已装模块采集：

```json
{
  "id": "mod-transmog",
  "dirname": "mod-transmog",
  "remote": "https://github.com/azerothcore/mod-transmog.git",
  "owner_repo": "azerothcore/mod-transmog",
  "branch": "master",
  "commit": "abc123def",
  "commit_date": "2026-03-01T00:00:00Z",
  "dirty": false,
  "listed_in_modules_list": true,
  "acore_module_json": { "raw": "{...}" },
  "has_conf": true,
  "conf_path": ".../etc/modules/transmog.conf",
  "loaded": true,
  "loaded_label": "Transmogrification"
}
```

另外附上核心上下文：

```json
{
  "core": {
    "version": "AzerothCore rev. 9abc123...",
    "revision": "9abc123",
    "deploy": "docker",
    "ac_root_writable": true
  }
}
```

采集方式：

| 字段 | 来源 |
|---|---|
| dirname / 是否存在 | 扫 `modules_dir`，忽略 `.` 开头和非目录 |
| remote / branch / commit | `git -C <dir> remote get-url origin`、`rev-parse`、`log -1` |
| modules.list | 解析官方格式：`repo_ref branch commit` |
| acore-module.json | 读模块根目录 |
| conf | `etc_modules_dir` 下文件名模糊匹配 `id`（去掉 `mod-`） |
| loaded | SOAP `server debug` 输出解析；解析失败则 `loaded=null` |
| core.version | 已有 `server info` |

`server debug` 需加入 SOAP allow 列表。只用于只读探测。

Inventory 缓存 60 秒；安装 Job 结束后强制失效。

---

## 6. 目录与手动添加

**常用列表（两层）：**

1. 面板内置精选（`api/data/modules/curated.json`）：transmog、ah-bot、anticheat、solocraft 等，含中英文简介、推荐理由、已知坑。
2. 官方 Catalogue：`GET https://www.azerothcore.org/data/catalogue.json`，过滤 topic `azerothcore-module`，按 star 排序。缓存 12 小时。

**手动添加：**

- 输入 `https://github.com/owner/repo` 或 `owner/repo` 或 `owner/repo@branch`。
- 规范化后只允许 `github.com`（可配 `modules.allowed_hosts`）。
- 预检：HEAD 仓库、是否有 `acore-module.json`、topics 是否含 `azerothcore-module`。
- 非白名单 owner：允许登记，但评估强制 `caution`，安装按钮额外警告。

登记写入面板侧 `data/module-registry.json`（按 Target），**此时还不 clone 到 `modules/`**。

---

## 7. GitHub 材料（含 Issues）

评估前由 API 拉取，不把「让模型自己上网」当作可靠来源。DeepSeek 无官方浏览工具时，必须服务端预取。

### 7.1 仓库文件

| 资源 | 用途 | 截断 |
|---|---|---|
| `acore-module.json` | 官方兼容版本 | 全文，一般很小 |
| `README.md`（及 `README.zh.md` 若有） | 安装步骤、手动操作 | 合计 ≤ 24KiB |
| 根 `CMakeLists.txt` 是否存在 | 像不像 AC 模块 | 布尔 + 首 2KiB |
| `data/sql/` 目录树 | 要不要跑 SQL、动哪套库 | 只列路径，不塞 SQL 原文 |
| `conf/*.conf.dist` 文件名 | 安装后要拷哪些 conf | 文件名列表 |
| 默认分支 / 最新 commit / 最近 release tag | 和本机已装 commit 对比 | 元数据 |

用 GitHub Contents API 或 `raw.githubusercontent.com`。优先 Contents API（有 rate limit 头）。建议配置可选 `GITHUB_TOKEN`，否则匿名配额很容易在扫 Issues 时打满。

### 7.2 Issues（全面了解问题）

一次评估拉三类，去重后封顶 **40 条**：

| 类 | 请求 | 目的 |
|---|---|---|
| 开放且最近更新 | `/issues?state=open&sort=updated&per_page=20` | 当前坑 |
| 开放高评论 | 同上结果按 `comments` 再取 Top | 老热点 |
| 最近关闭 | `/issues?state=closed&sort=updated&per_page=10` | 是否刚修 |

每条只保留结构化摘要，避免把整页评论塞进上下文：

```json
{
  "number": 123,
  "title": "Crash on 3.3.5a with mod-xxx",
  "state": "open",
  "labels": ["bug", "crash"],
  "comments": 14,
  "updated_at": "2026-08-01T00:00:00Z",
  "body_excerpt": "……截断 600 字……",
  "html_url": "https://github.com/..."
}
```

**关键词加权**（服务端打标，再给模型看）：`crash`、`compile`、`cmake`、`link`、`sql`、`duplicate`、`conflict`、`playerbots`、当前核心 revision 的短 SHA、已装模块名。命中的 Issues 排在前面。

**不拉：** Issue 全文评论树、PR diff、整仓库 zip。需要「某条 Issue 详情」时另做 `GET /modules/github/.../issues/:n`，给详情抽屉用，不默认进评估包。

缓存键：`owner/repo@default_branch_sha`，TTL 6 小时。安装前可强制刷新。

### 7.3 检索包大小

送给 DeepSeek 的 user 消息控制在约 **32–48KiB 文本**（加 JSON 结构）。超限时丢 README 后半、Issues body_excerpt，**永不丢**：core 版本、已装列表、`acore-module.json`、SQL 目录树、加权 Issues 标题。

---

## 8. DeepSeek 评估

### 8.1 角色

模型 = 顾问。输出 JSON，前端渲染。安装按钮仍走超管确认。

模型：**默认 `deepseek-v4-flash`**，JSON Mode，thinking 关闭，`temperature` 0.2。疑难模块可升 `deepseek-v4-pro`（配置项）。

### 8.2 输入（系统拼好，禁止模型自己编造本机状态）

```json
{
  "locale": "zh-CN",
  "core": { "version": "...", "revision": "...", "deploy": "docker" },
  "installed": [ { "id": "mod-playerbots", "commit": "...", "branch": "..." } ],
  "target_module": {
    "repo": "azerothcore/mod-transmog",
    "url": "https://github.com/azerothcore/mod-transmog",
    "ref": "master",
    "acore_module_json": {},
    "readme": "...",
    "has_cmake": true,
    "sql_paths": ["data/sql/db-world/xxx.sql"],
    "conf_dist": ["conf/transmog.conf.dist"],
    "issues": [ ]
  },
  "rules": [
    "只根据本 JSON 作答，不要用训练记忆补安装命令",
    "步骤必须能在 citations 里找到出处，否则不要写 command",
    "已安装模块可能冲突时写进 conflicts，不确定就写 unknown 并降低 verdict"
  ]
}
```

系统提示要点：

- 你是 AzerothCore 模块安装顾问，面向本面板的 Docker/源码两种部署。
- 必须考虑 **已安装模块及 commit**，指出已知冲突（例如某些 Lua/Eluna 与 C++ 模块、重复功能）。
- 必须阅读 Issues 摘要：把「编译失败 / 崩 / SQL / 与某某模块不兼容」写成 `risks`，并引用 `#编号`。
- `steps` 按本机 `deploy` 改写（Docker 用 compose build，源码用 acore.sh / cmake）。
- 不要声称 SQL 可按模块回滚；引导使用检查点。
- 输出必须是 JSON，字段固定。

### 8.3 输出契约

```json
{
  "verdict": "ok | caution | no",
  "compat_score": 0,
  "ac_version_match": "match | unknown | mismatch",
  "needs_rebuild": true,
  "needs_sql": true,
  "needs_client_patch": false,
  "conflicts": ["mod-xxx: 原因"],
  "issue_findings": [
    { "number": 12, "severity": "high", "summary": "1.8 核心上编译失败" }
  ],
  "risks": ["卸载后 SQL 不会自动回滚"],
  "steps": [
    {
      "title": "clone 到 modules/",
      "command": "git clone ... modules/mod-transmog",
      "source": "readme",
      "phase": "clone | checkpoint | build | sql | conf | restart | verify"
    }
  ],
  "missing_evidence": [],
  "citations": ["README.md#Installation", "issues#12", "acore-module.json"]
}
```

`compat_score` 仅展示用（0–100）。**最终能不能点安装**看 Rule Overlay 后的 `verdict`。

### 8.4 Rule Overlay（代码，不信任模型）

在模型返回之后强制降级：

| 条件 | 处理后 verdict 上限 |
|---|---|
| 无 `acore-module.json` 且 README 未出现 AzerothCore | `caution` |
| `acore-module.json` 与本机版本明确不匹配 | `no` |
| owner 不在 `allow_owners` | `caution`（仍可超管强装） |
| Issues 中开放且标题/标签命中 compile/crash，且模型没写进 `issue_findings` | 至少 `caution`，并补一条 finding |
| `missing_evidence` 含 README | 不得为 `ok` |
| GitHub 拉取失败 | 不调用模型，返回 `evaluate_degraded`，只展示原始链接 |

`ok` 仍要二次确认。`no` 默认禁用安装，超管可勾「忽略评估」。

### 8.5 缓存与降级

- 缓存键：`repo@commit + core.revision + hash(installed ids+commits) + issues_etag`。
- TTL 24 小时；「重新评估」按钮绕过。
- 无 `DEEPSEEK_API_KEY`：页面仍显示 GitHub README 摘要、Issues 列表、本机库存对比，评估区提示未配置。
- 模型空 JSON / 超时：同降级，不阻塞目录浏览。

---

## 9. 检查点与回退

检查点是安装/卸载的前置条件。ID：`20260910-114000-<shortid>`。

### 9.1 包内容

```
data/module-checkpoints/<id>/
  meta.json
  sql/auth.sql
  sql/characters.sql
  sql/world.sql
  sql/playerbots.sql          # 库未配置则跳过
  files/modules.list
  files/etc-modules/          # 当时整个 modules conf 目录副本
```

`meta.json`：

```json
{
  "id": "20260910-114000-ab12",
  "target_id": "lan",
  "created_at": "...",
  "reason": "pre-install:mod-transmog",
  "core_revision": "9abc123",
  "deploy": "docker",
  "world_image": "ac-worldserver:latest",
  "world_image_checkpoint_tag": "acmanage-ckpt-20260910-114000-ab12",
  "installed_then": [ { "id": "mod-playerbots", "commit": "..." } ],
  "sql_files": ["world", "characters", "auth", "playerbots"],
  "note": "回退会丢失该时刻之后的角色进度"
}
```

Docker：`docker tag <当前world镜像> acmanage-ckpt-<id>`，**禁止 prune 掉被检查点引用的镜像**。

源码：把 `worldserver` 二进制拷到 `bin/worldserver`（可选，体积大时只记路径 + sha256，由部署方保证文件还在）。

### 9.2 何时创建

- 安装 Job 第一步（强制）。
- 卸载 Job 第一步（强制）。
- 超管手动「打检查点」（可选）。

磁盘预检：四库 dump 预估失败则中止安装。保留最近 N 份（默认 5）+ 未回退成功的安装所引用的那份。

### 9.3 回退顺序（原子叙事，失败则停并告警）

1. SOAP 平滑关服或停 world 容器（超管已确认）。
2. 恢复镜像 tag 或二进制。
3. 导入四库 dump（**必须停服**）。
4. 恢复 `modules.list` 与 `etc/modules`。
5. 将 `modules/` 恢复到检查点时的目录集合：删除检查点之后新 clone 的目录；已有模块不强制 reset git（避免误伤本地改动）。P2-C 安装只允许面板自己 clone 的目录被删除。
6. 启动容器；SOAP `server info` + 可选 `server debug`。
7. 审计 `module.rollback`。

只恢复 SQL 或只恢复镜像都不提供单独按钮，避免半残状态。高级「仅恢复镜像」可放 Settings，默认隐藏。

### 9.4 覆盖范围（对用户展示）

| 问题 | 检查点能否救 |
|---|---|
| 编译失败、镜像未切换 | 一般不用回退 |
| 新进程起不来 / 运行期 hook 冲突 / 缺 .so | 恢复镜像或二进制，通常可以 |
| 模块 SQL 已执行、表结构已变 | 全库倒回，可以；玩家进度回到快照时刻 |
| 只想撤模块、保留这几小时新进度 | **做不到可靠** |
| 客户端补丁 | 不能 |

---

## 10. 安装 / 卸载 Job

长任务，禁止同步 HTTP 跑完编译。

### 10.1 状态机

```
queued → checkpointing → cloning → building → switching → verifying → succeeded
                         ↘ failed（编译/clone 失败，镜像未切：不必回退）
switching/verifying ↘ failed_need_rollback → rolling_back → rolled_back
                                              ↘ rollback_failed（人工介入）
cancelled（仅 queued / checkpointing / cloning）
```

同一 Target 同时只允许一个变更 Job（安装/卸载/回退互斥）。

### 10.2 安装步骤（Docker）

1. 评估缓存必须存在且未过期，或用户勾选「忽略评估」。
2. `verdict==no` 且未忽略 → 拒绝。
3. 打检查点。
4. `git clone --branch <ref> --depth 1` 到 `modules/<dirname>`；目录名去掉 `-master` 后缀。
5. 更新 `conf/modules.list`。
6. 若有 `.conf.dist`，拷到 `etc/modules/`（已存在则不覆盖，只提示）。
7. 在 `compose_dir` 执行 `docker compose build <world服务>`（超时可配，默认 45 分钟）。日志写入 Job 文件，WS 推送。
8. 停 world → 用新镜像起容器。
9. 等待 SOAP 就绪；`server debug` 确认模块名；失败则自动进入回退。
10. SQL：AC 多数在启动时自跑。若评估标记 `needs_sql` 且模块 README 要求拷到 `data/sql/custom`，P2-C 只做**明确列出的拷贝**，不执行任意 SQL 文件内容到生产库（避免模型幻觉路径）。拷贝名单来自检索包的 `sql_paths` 与 README 解析，需规则校验路径落在该模块目录内。

源码模式第 7 步改为调用 `./acore.sh compiler build`（路径可配），不在面板容器内编译。

### 10.3 卸载

1. 打检查点。
2. 从 `modules/` 删除该目录（仅当 remote 匹配登记仓库，防止删错）。
3. 从 `modules.list` 去掉对应行。
4. **默认保留** `etc/modules/*.conf` 和数据库表。
5. 重建并切换镜像（与安装相同，否则二进制里还链着旧模块）。
6. UI 明确：表数据仍在；要回到无该模块的库状态请用检查点回退，而不是「卸载」。

### 10.4 日志

`GET /api/v1/module-jobs/:id/logs/ws`，复用容器日志 WS 模式。Job 记录操作者、Target、检查点 ID、评估 ID。

---

## 11. 模块配置编辑

扩展现有 `/config`：

- `GET /config/files` 增加 `etc_modules_dir` 下所有 `*.conf`（排除 `.bak.*`）。
- 继续备份 `.bak.<timestamp>`、超管、`confirm`、审计 `conf.write`。
- 保存后可选 SOAP `.reload config`；无效则提示重启 world。
- 模块页深链到对应 conf。Playerbots 仍走现有专用页，不重复造第二套编辑器。

---

## 12. API

前缀 `/api/v1`，鉴权与 `X-Target-Id` 不变。写操作 `confirm: true`。

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/modules/catalog` | 登录 | 精选 + catalogue（query `q`） |
| POST | `/modules/registry` | 超管 | 登记 GitHub URL |
| DELETE | `/modules/registry/:id` | 超管 | 只删登记，不影响已 clone |
| GET | `/modules/installed` | 登录 | Inventory |
| GET | `/modules/:id` | 登录 | 合并目录信息 + 本机状态 |
| POST | `/modules/:id/evaluate` | GM | 拉 GitHub + Issues + DeepSeek |
| GET | `/modules/:id/evaluate` | GM | 读缓存 |
| GET | `/modules/:id/issues` | GM | 仅 Issues 列表（详情抽屉） |
| GET | `/modules/:id/conf` | 超管 | 模块 conf |
| PUT | `/modules/:id/conf` | 超管 | 保存 conf |
| POST | `/modules/checkpoints` | 超管 | 手动打检查点 |
| GET | `/modules/checkpoints` | 超管 | 列表 |
| POST | `/modules/checkpoints/:id/rollback` | 超管 | 整包回退 |
| POST | `/modules/:id/install` | 超管 | 入队安装 |
| POST | `/modules/:id/uninstall` | 超管 | 入队卸载 |
| GET | `/module-jobs` | 超管 | 当前/历史 Job |
| GET | `/module-jobs/:id` | 超管 | 状态 |
| GET | `/module-jobs/:id/logs/ws` | 超管 | 日志 |

`:id` 为目录名 slug（`mod-transmog`）。未安装而仅登记的，用同样 id。

错误码（稳定英文，走现有 i18n）：`modules_path_unavailable`、`evaluate_degraded`、`checkpoint_failed`、`job_conflict`、`verdict_blocked`、`github_rate_limited`、`deepseek_unconfigured`、`image_tag_missing`。

---

## 13. 前端

- 路由 `/modules`，侧栏放在「配置」附近，`minRole: gm`（安装按钮超管才显示）。
- 三 Tab：**精选目录 / 已安装 / 自定义登记**。
- 已安装行：dirname、branch、短 commit、是否 loaded、conf 入口。
- 详情：简介、评估卡片（verdict 色条、conflicts、issue_findings、steps）、Issues 列表（外链 GitHub）、安装/卸载、检查点选择。
- 评估中展示「正在拉 README / Issues / 调用 DeepSeek」分步状态。
- 安装向导：评估结果 → 检查点说明（进度会丢）→ confirm 短语（如模块 id）→ Job 进度。
- 文案中英都要写：AI 仅供参考；回退=整服回到快照。

---

## 14. 安全

- DeepSeek / GitHub Token 只在 `.env`。
- 送进模型的内容：公开仓库文本 + 核心版本 + 模块 id/commit。**禁止** SOAP 密码、MySQL 密码、玩家表、`.env`。
- clone URL 只允许 https GitHub（可配），拒绝本地路径、ssh 任意主机。
- clone 目录名正则：`^[A-Za-z0-9._-]+$`，禁止 `..`。
- SQL 拷贝路径必须是该模块目录下的相对路径 canonicalize 之后仍在模块根内。
- `docker tag` / `compose build` 只针对配置里的 compose 项目与 world 服务名，不开放任意镜像名给前端。
- 全写路径审计：evaluate 可记简略（repo+verdict）；checkpoint/install/uninstall/rollback 记全。

---

## 15. 配置草案

`.env` 增补：

```bash
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
GITHUB_TOKEN=          # 可选，提高 Issues/API 限额
MODULES_DEPLOY=docker  # docker | source
```

`api/config.yaml` Target 下：

```yaml
modules:
  enabled: true
  deploy: "${MODULES_DEPLOY}"
  modules_dir: "${AC_ROOT}/modules"
  modules_list: "${AC_ROOT}/conf/modules.list"
  etc_modules_dir: "${AC_ROOT}/docker/vol/etc/modules"
  compose_dir: "${AC_ROOT}"
  world_service: ac-worldserver
  allow_owners:
    - azerothcore
  checkpoint_keep: 5
  build_timeout_minutes: 45
```

未配置 API Key 时 P2-A 的评估降级，目录与 conf 仍可用。

---

## 16. 后端包划分

```
api/internal/
  modules/
    inventory.go     # 扫盘 + git + modules.list + server debug
    catalogue.go     # curated + 官方 JSON 缓存
    github.go        # README / acore-module.json / issues
    evaluate.go      # 拼检索包、调 DeepSeek、Rule Overlay
    checkpoint.go    # dump + image tag + 文件副本 + 回退
    job.go           # 状态机
    gitclone.go      # 受限 clone
    conf.go          # etc/modules 列表
  deepseek/
    client.go        # Chat Completions JSON Mode
```

Docker 镜像 tag 能力加在 `dockerx`（白名单 + 显式 tag 前缀 `acmanage-ckpt-`）。

SOAP allow 增加：`server debug`。

---

## 17. 分期任务（实现时按此切）

### P2-A

- [ ] P2-01 Target 配置与路径探测
- [ ] P2-02 Inventory（git 元数据 + modules.list）
- [ ] P2-03 SOAP `server debug` 解析 loaded
- [ ] P2-04 精选 JSON + Catalogue 缓存
- [ ] P2-05 登记 GitHub URL
- [ ] P2-06 GitHub 文件 + Issues 拉取与缓存
- [ ] P2-07 DeepSeek 评估 + Rule Overlay + 缓存
- [ ] P2-08 `etc/modules` conf 列入配置页
- [ ] P2-09 前端 `/modules` 目录 / 已装 / 评估 / Issues

### P2-B

- [ ] P2-10 检查点：四库 dump + modules.list + etc-modules 副本
- [ ] P2-11 Docker 镜像 tag / 源码二进制指纹
- [ ] P2-12 检查点列表与保留策略
- [ ] P2-13 整包回退 Job（停服 → 镜像 → SQL → 文件 → 启动）

### P2-C

- [ ] P2-14 安装 Job（clone、list、conf.dist、build、切换、verify）
- [ ] P2-15 卸载 Job（删目录、重建；默认保留 SQL）
- [ ] P2-16 Job 互斥、WS 日志、失败自动回退
- [ ] P2-17 路径白名单与 SQL 拷贝约束
- [ ] P2-18 审计与 i18n 错误码

---

## 18. 验收标准

**P2-A**

- 不配 DeepSeek 也能看目录、已装 commit、GitHub Issues。
- 配了 Key 后，评估 JSON 含 `installed` 感知的 `conflicts` 或明确 unknown；`issue_findings` 能对上真实 Issue 编号。
- 断开 GitHub 时页面降级而不是整页报死。

**P2-B**

- 打检查点后 `docker images` 能看到 `acmanage-ckpt-*`，且四库文件非空。
- 人为改一条 `world` 表数据后回退，数据回到检查点；world 容器回到旧镜像 ID。

**P2-C**

- 安装一个官方小模块（如仅 conf 的），Job 日志完整；`server debug` 可见。
- 故意让 build 失败：旧服仍在，不自动灌 SQL 回退。
- 安装成功后人为损坏再点回退：模块目录与清单恢复，服可登录。

---

## 19. 对玩家与运营的说明（UI 固定文案）

- 模块不是热插拔插件，安装需要重建并重启。
- AI 根据 README、兼容文件、**当前已装模块版本**和 **GitHub Issues** 评估，不能保证编译成功。
- 出问题用检查点回退整服（程序 + 数据库），会丢失快照之后的游戏进度。
- 卸载只去掉代码并重建，默认不删数据库里的模块表。
