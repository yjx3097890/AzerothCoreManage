package modules

import (
	"os"
	"path/filepath"
	"strings"

	"acmanage/internal/config"
)

// CoreConfSnapshot is a live config file included in checkpoints.
type CoreConfSnapshot struct {
	ID       string // worldserver | authserver | compose_override | playerbots
	Label    string
	LivePath string
	StoreAs  string // basename under files/core/
}

// ListCoreConfSnapshots returns world/auth/compose override/playerbots paths for a target.
func ListCoreConfSnapshots(t *config.Target) []CoreConfSnapshot {
	if t == nil {
		return nil
	}
	conf := t.Conf
	out := []CoreConfSnapshot{}

	ws := strings.TrimSpace(conf.WorldserverConf)
	if ws == "" && conf.EtcDir != "" {
		ws = filepath.Join(conf.EtcDir, "worldserver.conf")
	}
	if ws != "" {
		out = append(out, CoreConfSnapshot{
			ID: "worldserver", Label: "World Server", LivePath: ws, StoreAs: "worldserver.conf",
		})
	}

	as := strings.TrimSpace(conf.AuthserverConf)
	if as == "" && conf.EtcDir != "" {
		as = filepath.Join(conf.EtcDir, "authserver.conf")
	}
	if as != "" {
		out = append(out, CoreConfSnapshot{
			ID: "authserver", Label: "Auth Server", LivePath: as, StoreAs: "authserver.conf",
		})
	}

	if p := resolveComposeOverridePath(t); p != "" {
		out = append(out, CoreConfSnapshot{
			ID: "compose_override", Label: "Docker Compose Override", LivePath: p, StoreAs: filepath.Base(p),
		})
	}

	pb := strings.TrimSpace(conf.PlayerbotsConf)
	if pb == "" && conf.EtcDir != "" {
		for _, cand := range []string{
			filepath.Join(conf.EtcDir, "modules", "playerbots.conf"),
			filepath.Join(conf.EtcDir, "playerbots.conf"),
		} {
			if st, err := os.Stat(cand); err == nil && !st.IsDir() {
				pb = cand
				break
			}
		}
	}
	if pb != "" {
		out = append(out, CoreConfSnapshot{
			ID: "playerbots", Label: "Playerbots", LivePath: pb, StoreAs: "playerbots.conf",
		})
	}

	return out
}

func resolveComposeOverridePath(t *config.Target) string {
	dir := strings.TrimSpace(t.Modules.ComposeDir)
	if dir == "" {
		return ""
	}
	candidates := []string{
		filepath.Join(dir, "docker-compose.override.yml"),
		filepath.Join(dir, "compose.override.yml"),
		filepath.Join(dir, "docker-compose.override.yaml"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return candidates[0]
}
