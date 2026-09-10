package modules

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type RegistryEntry struct {
	ID        string    `json:"id"`
	OwnerRepo string    `json:"owner_repo"`
	URL       string    `json:"url"`
	Ref       string    `json:"ref,omitempty"`
	TargetID  string    `json:"target_id"`
	AddedAt   time.Time `json:"added_at"`
	AddedBy   string    `json:"added_by,omitempty"`
	HasACore  *bool     `json:"has_acore_module_json,omitempty"`
	Topics    []string  `json:"topics,omitempty"`
}

type registryFile struct {
	Items []RegistryEntry `json:"items"`
}

var registryMu sync.Mutex

func LoadRegistry(path, targetID string) ([]RegistryEntry, error) {
	registryMu.Lock()
	defer registryMu.Unlock()
	all, err := readRegistry(path)
	if err != nil {
		return nil, err
	}
	var out []RegistryEntry
	for _, it := range all.Items {
		if targetID == "" || it.TargetID == targetID || it.TargetID == "" {
			out = append(out, it)
		}
	}
	return out, nil
}

func AddRegistry(path string, entry RegistryEntry) error {
	registryMu.Lock()
	defer registryMu.Unlock()
	all, err := readRegistry(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for i, it := range all.Items {
		if it.TargetID == entry.TargetID && strings.EqualFold(it.ID, entry.ID) {
			all.Items[i] = entry
			return writeRegistry(path, all)
		}
	}
	all.Items = append(all.Items, entry)
	return writeRegistry(path, all)
}

func RemoveRegistry(path, targetID, id string) error {
	registryMu.Lock()
	defer registryMu.Unlock()
	all, err := readRegistry(path)
	if err != nil {
		return err
	}
	next := all.Items[:0]
	found := false
	for _, it := range all.Items {
		if it.TargetID == targetID && strings.EqualFold(it.ID, id) {
			found = true
			continue
		}
		next = append(next, it)
	}
	if !found {
		return fmt.Errorf("not found")
	}
	all.Items = next
	return writeRegistry(path, all)
}

func readRegistry(path string) (registryFile, error) {
	var all registryFile
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return registryFile{Items: []RegistryEntry{}}, nil
		}
		return all, err
	}
	if len(raw) == 0 {
		return registryFile{Items: []RegistryEntry{}}, nil
	}
	if err := json.Unmarshal(raw, &all); err != nil {
		return all, err
	}
	if all.Items == nil {
		all.Items = []RegistryEntry{}
	}
	return all, nil
}

func writeRegistry(path string, all registryFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ParseGitHubSpec accepts owner/repo, owner/repo@branch, or https://github.com/owner/repo[.git]
func ParseGitHubSpec(raw string, allowedHosts []string) (ownerRepo, ref, url string, err error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", "", fmt.Errorf("empty url")
	}
	ref = ""
	if i := strings.LastIndex(raw, "@"); i > 0 && !strings.Contains(raw[i:], "/") {
		// owner/repo@branch — but not user@host
		maybe := raw[i+1:]
		if !strings.Contains(maybe, ":") && maybe != "" {
			ref = maybe
			raw = raw[:i]
		}
	}
	raw = strings.TrimSuffix(raw, ".git")
	raw = strings.TrimRight(raw, "/")

	hostOK := func(host string) bool {
		host = strings.ToLower(host)
		if len(allowedHosts) == 0 {
			return host == "github.com"
		}
		for _, h := range allowedHosts {
			if strings.EqualFold(strings.TrimSpace(h), host) {
				return true
			}
		}
		return false
	}

	if strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "http://") {
		u := strings.TrimPrefix(strings.TrimPrefix(raw, "https://"), "http://")
		parts := strings.Split(u, "/")
		if len(parts) < 3 {
			return "", "", "", fmt.Errorf("invalid github url")
		}
		host := parts[0]
		if !hostOK(host) {
			return "", "", "", fmt.Errorf("host not allowed")
		}
		ownerRepo = parts[1] + "/" + parts[2]
	} else if strings.Count(raw, "/") == 1 {
		ownerRepo = raw
	} else {
		return "", "", "", fmt.Errorf("expected owner/repo or github url")
	}
	parts := strings.Split(ownerRepo, "/")
	if len(parts) != 2 || !IsSafeModuleID(parts[0]) || !IsSafeModuleID(parts[1]) {
		return "", "", "", fmt.Errorf("invalid owner/repo")
	}
	url = "https://github.com/" + ownerRepo
	return ownerRepo, ref, url, nil
}

func ModuleIDFromOwnerRepo(ownerRepo string) string {
	if i := strings.LastIndex(ownerRepo, "/"); i >= 0 {
		return ownerRepo[i+1:]
	}
	return ownerRepo
}
