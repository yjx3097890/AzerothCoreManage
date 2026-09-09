# AzerothCore Manage

[简体中文](README.md) | English

A web admin panel for **AzerothCore** (including **mod-playerbots**). Manage day-to-day ops from the browser instead of living in SSH and the worldserver console.

Stack: **Go (Gin) + React (Vite / Ant Design)**. Commands go through SOAP; lists and stats come from MySQL; Docker is optional for container lifecycle.

> Licensed as **paid commercial software**: Non-commercial use is covered by [LICENSE](LICENSE). **Any Commercial Use requires a separate paid license.**

## Features

| Area | Highlights |
|------|------------|
| Dashboard | Online players, uptime, real players vs bots, health checks |
| Containers | Whitelisted start / stop / restart / logs (Docker can be disabled) |
| Accounts / Characters | Search, GM level, passwords, kick, teleport, mail items, inventory, … |
| Moderation / Mail / Announcements | Ban, mute, mail, MOTD (per client locale), autobroadcast |
| Guilds / Arena / Auctions | Browse and common management; auctions are read-only for now |
| World events / Disables | Start/stop events; localized disables list |
| Playerbots | Overview, online bots, rndbot actions, config, guilds |
| Config / Backup / SQL / Audit | Conf editing, backups, read-only SQL browser, audit log |
| i18n | Panel UI zh-CN / en-US; map/class/disable reasons follow locale |

See [docs/tasks.md](docs/tasks.md) for the checklist and [docs/architecture.md](docs/architecture.md) for design notes.

## Quick start

### 1. Configuration

Use a single `config.yaml` (gitignored). Do not duplicate secrets in `.env`:

```bash
cp config.example.yaml config.yaml
# Edit panel / soap / mysql / docker
```

- **Local development**: set `soap.host` / `mysql.host` to your realm IP (or localhost-mapped ports).
- **Same-host Docker**: you may use container names and join the game network; enable `docker.enabled` if needed.

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

Open the Vite URL and sign in with `panel.admin_*` from `config.yaml`.

### 3. Docker deploy

```bash
docker compose up -d --build
```

- Web: http://localhost:5174  
- API: http://localhost:8080  
- Logs: `api/logs/` locally (Compose may also mount repo `logs/`)

## Stack

| Layer | Choice |
|-------|--------|
| Frontend | React + TypeScript + Vite + Ant Design + i18next |
| Backend | Go + Gin + JWT RBAC (viewer / GM / superadmin) |
| Commands | SOAP `executeCommand` (allow-list) |
| Data | MySQL: auth / characters / world / playerbots |
| Processes | Docker Engine API (optional, container allow-list) |

The browser never talks to SOAP, MySQL, or Docker directly. Credentials stay inside the API process.

## Docs

- [Architecture](docs/architecture.md) (Chinese)
- [Task list](docs/tasks.md) (Chinese)
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
