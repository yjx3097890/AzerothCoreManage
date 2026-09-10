# AzerothCore Manage

[简体中文](README.md) | English

A web admin panel for **AzerothCore** (including **mod-playerbots**). Manage day-to-day ops from the browser instead of living in SSH and the worldserver console.

Stack: **Go (Gin) + React (Vite / Tailwind CSS / DaisyUI)**. Commands go through SOAP; lists and stats come from MySQL; Docker is optional for container lifecycle.

> Licensed as **paid commercial software**: Non-commercial use is covered by [LICENSE](LICENSE). **Any Commercial Use requires a separate paid license.**

## Features

| Area | Highlights |
|------|------------|
| Dashboard | Online players, uptime, real players vs bots, health checks |
| Containers | Whitelisted start / stop / restart / **logs** (Docker can be disabled) |
| Accounts / Characters | Search, GM level, passwords, kick, teleport, mail items, inventory, … |
| Moderation / Mail / Announcements | Ban, mute, mail, MOTD (per client locale), autobroadcast |
| Guilds / Arena / Auctions | Browse and common management; auctions are read-only for now |
| World events / Disables | Start/stop events; localized disables list |
| Playerbots | Overview, online bots, rndbot actions, config, guilds |
| Modules (P2-A/B) | Curated / official catalog, installed scan, GitHub registry, DeepSeek eval, module conf, **checkpoints + full rollback** (**install orchestration still closed**) |
| Config / Backup / DB browser / Audit | Conf editing, **SQL backup/restore**, **module checkpoints**, read-only table browser, audit |
| i18n | Panel UI zh-CN / en-US; map/class/disable reasons follow locale; **evaluation text follows UI language** |

See [docs/tasks.md](docs/tasks.md) for the checklist and [docs/architecture.md](docs/architecture.md) for design notes. Module manager design: [docs/module-manager.md](docs/module-manager.md).

## Module manager (P2-A / P2-B shipped)

Open **Modules** in the sidebar (`/modules`). **Does not auto-install modules**. Checkpoints and SQL backups live under **Config / Backup** (`/config`).

| Capability | Notes |
|------------|------|
| Curated catalog | Local `api/data/modules/curated.json` (localized names/summaries); GitHub fills missing `pushed_at` / stars. Packaged into the Docker image and bind-mounted for live edits |
| Official catalog | Repos tagged `azerothcore-module` from the [AzerothCore catalogue](https://www.azerothcore.org/data/catalogue.json) |
| Sorting | Click column headers: name, repo, **last push**, **★**, source, … |
| Installed | Scan `AC_ROOT/modules` + `modules.list`; SOAP `server debug` for loaded state (**API must see that path**; Docker deploy needs the volume mounts in `docker-compose.yml`) |
| Custom registry | Paste a GitHub URL to evaluate (superadmin) |
| AI evaluation | README / `acore-module.json` / Issues → DeepSeek + rules → score, feature summary, advice, risks |
| Module conf | Edit `etc/modules/*.conf` from the modules or config page |
| Checkpoints / full rollback (superadmin) | Under **Config / Backup → Module checkpoints**: four DBs + list/etc + Docker image tag; confirm phrase = checkpoint ID. **Discards character progress after the snapshot** |

**Local core version** resolution order: SOAP `server info` → `AC_ROOT` git → `.env` fallback:

```bash
AC_CORE_VERSION=AzerothCore rev. 413bea61a85e+ …
AC_CORE_REVISION=413bea61a85e
```

Optional evaluation settings:

```bash
MODULES_DEPLOY=docker          # docker | source
DEEPSEEK_API_KEY=              # without it, rule-based eval only
DEEPSEEK_BASE_URL=https://api.deepseek.com   # OpenAI-compatible; calls {BASE}/chat/completions
DEEPSEEK_MODEL=deepseek-v4-flash
GITHUB_TOKEN=                  # higher GitHub API limits (read-only is enough for public repos)
```

The evaluator uses the **OpenAI Chat Completions** protocol (`/chat/completions` + JSON mode).  
Any compatible endpoint usually works: official DeepSeek, OpenAI (`https://api.openai.com/v1`), and most local/third-party gateways. Point `DEEPSEEK_BASE_URL` / model / key at the provider; if they require a `/v1` prefix, include `/v1` in the base URL.

**P2-C install orchestration** is not available yet — see the design doc. Checkpoint dir defaults to `data/module-checkpoints` (`modules_global.checkpoint_dir`).

## Quick start

### 1. Configuration

Backend structure lives in `api/config.yaml` (tracked); secrets and machine paths go in the repo-root `.env` (gitignored):

```bash
cp .env.example .env
# Edit .env: AC_ROOT, ports, credentials, SOAP/MySQL
```

`api/config.yaml` supports `${VAR}`; the API loads the root `.env` and expands them.  
Docker Compose uses the same `.env` for ports, volumes, and the external network name.

- **Local development**: set SOAP/MySQL hosts to the realm IP in `.env`
- **Same-host Docker**: you may use container names; keep `AC_NETWORK` aligned with the game compose network

Enable SOAP on the realm, for example:

```ini
SOAP.Enabled = 1
SOAP.IP = "0.0.0.0"
SOAP.Port = 7878
```

### 2. Local development

```bash
make api   # API on :8080 by default
make web   # Web on :5173 by default
```

- Web: http://localhost:5173  
- API: http://localhost:8080 (Vite proxies `/api` in dev)

Open the Vite URL and sign in with `PANEL_ADMIN_*` from `.env`.

### 3. Docker deploy

```bash
docker compose up -d --build
```

- Panel: http://localhost:${ACMANAGE_WEB_PORT:-8086} (default 8086)  
- API is not published; nginx in the web container proxies `/api/`  
- Logs: repo `logs/` (compose mount)

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | React + TypeScript + Vite + Tailwind CSS + DaisyUI + i18next |
| Backend | Go + Gin + JWT RBAC (viewer / GM / superadmin) |
| Commands | SOAP `executeCommand` (allow-list) |
| Data | MySQL: auth / characters / world / playerbots |
| Processes | Docker Engine API (optional, container allow-list) |

The browser never talks to SOAP, MySQL, or Docker directly. Credentials stay inside the API process.

## Docs

- [Architecture](docs/architecture.md) (Chinese)
- [Task list](docs/tasks.md) (Chinese)
- [Module manager design (P2)](docs/module-manager.md) (Chinese)
- [i18n notes](docs/i18n.md) (Chinese)
- [简体中文 README](README.md)

## License & commercial use

Copyright is held by the author(s). See [LICENSE](LICENSE).

| Use case | Allowed? |
|----------|----------|
| Personal learning, evaluation, non-profit private servers | Yes (under LICENSE) |
| Paid hosting, selling the panel, revenue-generating commercial realms, commercial redistribution, etc. | **No** — purchase a commercial license |

For commercial, OEM, multi-instance, or white-label terms, email **315644588@qq.com**.

**Disclaimer**: This project is not affiliated with Blizzard Entertainment or the AzerothCore project. Comply with applicable law and third-party terms. The Software is provided “AS IS” without warranty.
