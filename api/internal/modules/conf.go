package modules

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type ModuleConfFile struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Available bool   `json:"available"`
	Size      int64  `json:"size,omitempty"`
	ModuleHint string `json:"module_hint,omitempty"`
}

func ListEtcModuleConfs(etcModulesDir string) []ModuleConfFile {
	var out []ModuleConfFile
	if etcModulesDir == "" {
		return out
	}
	entries, err := os.ReadDir(etcModulesDir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || strings.Contains(name, ".bak.") || !strings.HasSuffix(name, ".conf") {
			continue
		}
		base := strings.TrimSuffix(name, ".conf")
		path := filepath.Join(etcModulesDir, name)
		item := ModuleConfFile{
			ID:         "modconf:" + base,
			Name:       name,
			Path:       path,
			Available:  true,
			ModuleHint: base,
		}
		if st, err := e.Info(); err == nil {
			item.Size = st.Size()
		}
		out = append(out, item)
	}
	return out
}

func ResolveModuleConf(etcModulesDir, idOrName string) (string, error) {
	idOrName = strings.TrimSpace(idOrName)
	idOrName = strings.TrimPrefix(idOrName, "modconf:")
	if idOrName == "" || strings.Contains(idOrName, "..") || strings.ContainsAny(idOrName, `/\`) {
		return "", fmt.Errorf("bad conf id")
	}
	if !strings.HasSuffix(idOrName, ".conf") {
		idOrName += ".conf"
	}
	path := filepath.Join(etcModulesDir, idOrName)
	absEtc, err := filepath.Abs(etcModulesDir)
	if err != nil {
		return "", err
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(absPath, absEtc+string(os.PathSeparator)) && absPath != absEtc {
		return "", fmt.Errorf("path escape")
	}
	return absPath, nil
}

func FindConfForModule(etcModulesDir, moduleID string) (ModuleConfFile, bool) {
	key := normalizeConfKey(moduleID)
	for _, c := range ListEtcModuleConfs(etcModulesDir) {
		if normalizeConfKey(c.ModuleHint) == key {
			return c, true
		}
	}
	return ModuleConfFile{}, false
}
