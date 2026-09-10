package modules

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type CoreInfo struct {
	Version        string `json:"version"`
	Revision       string `json:"revision"`
	Deploy         string `json:"deploy"`
	ACRootWritable bool   `json:"ac_root_writable"`
	Source         string `json:"source,omitempty"` // soap | git | config
}

type InstalledModule struct {
	ID                  string          `json:"id"`
	Dirname             string          `json:"dirname"`
	Remote              string          `json:"remote,omitempty"`
	OwnerRepo           string          `json:"owner_repo,omitempty"`
	Branch              string          `json:"branch,omitempty"`
	Commit              string          `json:"commit,omitempty"`
	CommitDate          string          `json:"commit_date,omitempty"`
	Dirty               bool            `json:"dirty"`
	ListedInModulesList bool            `json:"listed_in_modules_list"`
	ACoreModuleJSON     json.RawMessage `json:"acore_module_json,omitempty"`
	HasConf             bool            `json:"has_conf"`
	ConfPath            string          `json:"conf_path,omitempty"`
	ConfID              string          `json:"conf_id,omitempty"`
	Loaded              *bool           `json:"loaded"`
	LoadedLabel         string          `json:"loaded_label,omitempty"`
}

type Inventory struct {
	Core      CoreInfo          `json:"core"`
	Items     []InstalledModule `json:"items"`
	Paths     Paths             `json:"paths"`
	FetchedAt time.Time         `json:"fetched_at"`
}

type inventoryCache struct {
	mu    sync.Mutex
	byKey map[string]cachedInv
}

type cachedInv struct {
	inv Inventory
	at  time.Time
}

var invCache = &inventoryCache{byKey: map[string]cachedInv{}}

func InvalidateInventory(targetID string) {
	invCache.mu.Lock()
	defer invCache.mu.Unlock()
	delete(invCache.byKey, targetID)
}

func CollectInventory(ctx context.Context, targetID string, paths Paths, core CoreInfo, loaded map[string]string) Inventory {
	core.Deploy = paths.Deploy
	core.ACRootWritable = paths.ModulesDirRW

	invCache.mu.Lock()
	if c, ok := invCache.byKey[targetID]; ok && time.Since(c.at) < 60*time.Second {
		out := c.inv
		// Always refresh core for this request (SOAP/git/config may have changed).
		out.Core = core
		invCache.mu.Unlock()
		return out
	}
	invCache.mu.Unlock()

	inv := Inventory{
		Core:      core,
		Items:     []InstalledModule{},
		Paths:     paths,
		FetchedAt: time.Now().UTC(),
	}
	listed := parseModulesList(paths.ModulesList)
	confIndex := indexModuleConfs(paths.EtcModulesDir)

	if paths.ModulesDirOK {
		entries, err := os.ReadDir(paths.ModulesDir)
		if err == nil {
			for _, e := range entries {
				if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
					continue
				}
				dirname := e.Name()
				if !IsSafeModuleID(dirname) {
					continue
				}
				mod := scanModuleDir(ctx, filepath.Join(paths.ModulesDir, dirname), dirname)
				if _, ok := listed[dirname]; ok {
					mod.ListedInModulesList = true
				} else if mod.OwnerRepo != "" {
					if _, ok := listed[mod.OwnerRepo]; ok {
						mod.ListedInModulesList = true
					}
				}
				if conf, ok := confIndex[normalizeConfKey(dirname)]; ok {
					mod.HasConf = true
					mod.ConfPath = conf.path
					mod.ConfID = conf.id
				}
				if loaded != nil {
					if label, ok := matchLoaded(dirname, loaded); ok {
						t := true
						mod.Loaded = &t
						mod.LoadedLabel = label
					} else {
						f := false
						mod.Loaded = &f
					}
				}
				inv.Items = append(inv.Items, mod)
			}
		}
	}

	invCache.mu.Lock()
	invCache.byKey[targetID] = cachedInv{inv: inv, at: time.Now()}
	invCache.mu.Unlock()
	return inv
}

func scanModuleDir(ctx context.Context, dir, dirname string) InstalledModule {
	mod := InstalledModule{ID: dirname, Dirname: dirname}
	mod.Remote = gitOutput(ctx, dir, "remote", "get-url", "origin")
	mod.OwnerRepo = OwnerRepoFromRemote(mod.Remote)
	mod.Branch = gitOutput(ctx, dir, "rev-parse", "--abbrev-ref", "HEAD")
	mod.Commit = gitOutput(ctx, dir, "rev-parse", "HEAD")
	if mod.Commit != "" && len(mod.Commit) > 12 {
		mod.Commit = mod.Commit[:12]
	}
	mod.CommitDate = gitOutput(ctx, dir, "log", "-1", "--format=%cI")
	status := gitOutput(ctx, dir, "status", "--porcelain")
	mod.Dirty = strings.TrimSpace(status) != ""
	if raw, err := os.ReadFile(filepath.Join(dir, "acore-module.json")); err == nil && len(raw) > 0 {
		mod.ACoreModuleJSON = json.RawMessage(raw)
	}
	return mod
}

func gitOutput(ctx context.Context, dir string, args ...string) string {
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, "git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func OwnerRepoFromRemote(remote string) string {
	remote = strings.TrimSpace(remote)
	remote = strings.TrimSuffix(remote, ".git")
	remote = strings.TrimPrefix(remote, "git@github.com:")
	remote = strings.TrimPrefix(remote, "https://github.com/")
	remote = strings.TrimPrefix(remote, "http://github.com/")
	remote = strings.TrimPrefix(remote, "ssh://git@github.com/")
	parts := strings.Split(remote, "/")
	if len(parts) >= 2 {
		return parts[len(parts)-2] + "/" + parts[len(parts)-1]
	}
	return ""
}

func parseModulesList(path string) map[string]struct{} {
	out := map[string]struct{}{}
	if path == "" {
		return out
	}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		ref := fields[0]
		out[ref] = struct{}{}
		if i := strings.LastIndex(ref, "/"); i >= 0 {
			out[ref[i+1:]] = struct{}{}
		}
		if i := strings.Index(ref, ":"); i >= 0 {
			// custom dirname: repo:dirname
			out[ref[i+1:]] = struct{}{}
		}
		or := OwnerRepoFromRemote(ref)
		if or != "" {
			out[or] = struct{}{}
		}
	}
	return out
}

type confEntry struct {
	id   string
	path string
}

func indexModuleConfs(dir string) map[string]confEntry {
	out := map[string]confEntry{}
	if dir == "" {
		return out
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || strings.Contains(name, ".bak.") || !strings.HasSuffix(name, ".conf") {
			continue
		}
		base := strings.TrimSuffix(name, ".conf")
		id := "modconf:" + base
		path := filepath.Join(dir, name)
		out[normalizeConfKey(base)] = confEntry{id: id, path: path}
		out[normalizeConfKey("mod-"+base)] = confEntry{id: id, path: path}
	}
	return out
}

func normalizeConfKey(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "mod-")
	s = strings.ReplaceAll(s, "_", "-")
	return s
}

func matchLoaded(dirname string, loaded map[string]string) (string, bool) {
	key := normalizeConfKey(dirname)
	for k, label := range loaded {
		if normalizeConfKey(k) == key || strings.Contains(normalizeConfKey(label), key) || strings.Contains(key, normalizeConfKey(label)) {
			return label, true
		}
		if strings.EqualFold(k, dirname) {
			return label, true
		}
	}
	return "", false
}

// ParseServerDebug extracts module labels from `.server debug` output.
// Returns map of rough id/name -> display label. Nil if empty/unparseable.
func ParseServerDebug(raw string) map[string]string {
	out := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	inMods := false
	for _, line := range strings.Split(raw, "\n") {
		l := strings.TrimSpace(line)
		low := strings.ToLower(l)
		if strings.Contains(low, "module") && (strings.Contains(low, "loaded") || strings.Contains(low, "list") || strings.HasSuffix(low, ":")) {
			inMods = true
			continue
		}
		if inMods && l == "" {
			continue
		}
		if inMods && (strings.HasPrefix(low, "using") || strings.HasPrefix(low, "world") || strings.HasPrefix(low, "auth")) {
			inMods = false
			continue
		}
		// Lines like: "- Transmogrification" or "mod-transmog" or "  * Foo"
		name := strings.TrimLeft(l, "-*• \t")
		name = strings.TrimSpace(name)
		if name == "" || len(name) > 120 {
			continue
		}
		if strings.Contains(low, "azerothcore") && strings.Contains(low, "rev") {
			continue
		}
		if inMods || strings.HasPrefix(strings.ToLower(name), "mod-") {
			out[name] = name
			out[normalizeConfKey(name)] = name
		}
	}
	if len(out) == 0 {
		// Fallback: any line mentioning mod-
		for _, line := range strings.Split(raw, "\n") {
			l := strings.TrimSpace(line)
			if strings.Contains(strings.ToLower(l), "mod-") {
				name := strings.TrimLeft(l, "-*• \t")
				out[name] = name
			}
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func ShortRevision(version string) string {
	version = strings.TrimSpace(version)
	// e.g. "AzerothCore rev. abc123def+"
	for _, p := range strings.Fields(version) {
		p = strings.Trim(p, "+.,")
		if len(p) >= 7 && isHexish(p) {
			if len(p) > 12 {
				return p[:12]
			}
			return p
		}
	}
	return version
}

// FillCoreFromGit sets Version/Revision from the AC source tree when SOAP is down.
// ModulesDir is usually $AC_ROOT/modules; we probe $AC_ROOT and its parent.
func FillCoreFromGit(ctx context.Context, core *CoreInfo, paths Paths) {
	if core == nil || strings.TrimSpace(core.Revision) != "" {
		return
	}
	roots := []string{}
	if paths.ModulesDir != "" {
		roots = append(roots, filepath.Dir(paths.ModulesDir), paths.ModulesDir)
	}
	if paths.ComposeDir != "" {
		roots = append(roots, paths.ComposeDir, filepath.Dir(paths.ComposeDir))
	}
	for _, root := range roots {
		if root == "" || root == "." || root == "/" {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
			continue
		}
		cmd := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--short=12", "HEAD")
		out, err := cmd.Output()
		if err != nil {
			continue
		}
		rev := strings.TrimSpace(string(out))
		if rev == "" {
			continue
		}
		core.Revision = rev
		branch := ""
		if b, err := exec.CommandContext(ctx, "git", "-C", root, "rev-parse", "--abbrev-ref", "HEAD").Output(); err == nil {
			branch = strings.TrimSpace(string(b))
		}
		if core.Version == "" {
			if branch != "" && branch != "HEAD" {
				core.Version = "git " + branch + " @" + rev
			} else {
				core.Version = "git @" + rev
			}
		}
		core.Source = "git"
		return
	}
}

// ApplyConfiguredCore fills Version/Revision from panel config as last resort.
func ApplyConfiguredCore(core *CoreInfo, configuredVersion, configuredRevision string) {
	if core == nil {
		return
	}
	configuredVersion = strings.TrimSpace(configuredVersion)
	configuredRevision = strings.TrimSpace(configuredRevision)
	if configuredVersion == "${AC_CORE_VERSION}" {
		configuredVersion = ""
	}
	if configuredRevision == "${AC_CORE_REVISION}" {
		configuredRevision = ""
	}
	if configuredVersion == "" && configuredRevision == "" {
		return
	}
	filled := false
	if strings.TrimSpace(core.Version) == "" && configuredVersion != "" {
		core.Version = configuredVersion
		filled = true
	}
	if strings.TrimSpace(core.Revision) == "" {
		if configuredRevision != "" {
			core.Revision = configuredRevision
			filled = true
		} else if configuredVersion != "" {
			core.Revision = ShortRevision(configuredVersion)
			filled = true
		}
	}
	if filled && core.Source == "" {
		core.Source = "config"
	}
	if filled && core.Version == "" && core.Revision != "" {
		core.Version = "configured @" + core.Revision
	}
}

func isHexish(s string) bool {
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}
