package modules

import (
	"os"
	"path/filepath"
	"strings"

	"acmanage/internal/config"
)

// Paths resolves filesystem locations for a target's module manager.
type Paths struct {
	Enabled       bool     `json:"enabled"`
	Deploy        string   `json:"deploy"`
	ModulesDir    string   `json:"modules_dir"`
	ModulesList   string   `json:"modules_list"`
	EtcModulesDir  string   `json:"etc_modules_dir"`
	ComposeDir     string   `json:"compose_dir"`
	PlayerbotsConf string   `json:"playerbots_conf,omitempty"`
	AllowOwners    []string `json:"allow_owners"`
	AllowedHosts   []string `json:"allowed_hosts"`
	ModulesDirOK   bool     `json:"modules_dir_ok"`
	ModulesDirRW   bool     `json:"modules_dir_rw"`
	EtcModulesOK   bool     `json:"etc_modules_ok"`
}

func ResolvePaths(t *config.Target) Paths {
	m := t.Modules
	p := Paths{
		Enabled:        m.Enabled,
		Deploy:         m.Deploy,
		ModulesDir:     m.ModulesDir,
		ModulesList:    m.ModulesList,
		EtcModulesDir:  m.EtcModulesDir,
		ComposeDir:     m.ComposeDir,
		PlayerbotsConf: strings.TrimSpace(t.Conf.PlayerbotsConf),
		AllowOwners:    append([]string{}, m.AllowOwners...),
		AllowedHosts:   append([]string{}, m.AllowedHosts...),
	}
	if p.Deploy == "" {
		p.Deploy = "docker"
	}
	if p.ModulesDir != "" {
		if st, err := os.Stat(p.ModulesDir); err == nil && st.IsDir() {
			p.ModulesDirOK = true
			p.ModulesDirRW = dirWritable(p.ModulesDir)
		}
	}
	if p.EtcModulesDir != "" {
		if st, err := os.Stat(p.EtcModulesDir); err == nil && st.IsDir() {
			p.EtcModulesOK = true
		}
	}
	return p
}

func dirWritable(dir string) bool {
	probe := filepath.Join(dir, ".acmanage-write-probe")
	if err := os.WriteFile(probe, []byte("ok"), 0o644); err != nil {
		return false
	}
	_ = os.Remove(probe)
	return true
}

func IsSafeModuleID(id string) bool {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 96 || strings.Contains(id, "..") {
		return false
	}
	for _, r := range id {
		if !(r == '_' || r == '-' || r == '.' ||
			(r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func OwnerAllowed(owners []string, owner string) bool {
	owner = strings.ToLower(strings.TrimSpace(owner))
	for _, o := range owners {
		if strings.ToLower(strings.TrimSpace(o)) == owner {
			return true
		}
	}
	return false
}
