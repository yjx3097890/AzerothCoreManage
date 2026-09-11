package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type CuratedModule struct {
	ID           string   `json:"id"`
	OwnerRepo    string   `json:"owner_repo"`
	URL          string   `json:"url"`
	NameZH       string   `json:"name_zh"`
	NameEN       string   `json:"name_en"`
	SummaryZH    string   `json:"summary_zh"`
	SummaryEN    string   `json:"summary_en"`
	Tags         []string `json:"tags,omitempty"`
	KnownRisksZH string   `json:"known_risks_zh,omitempty"`
	KnownRisksEN string   `json:"known_risks_en,omitempty"`
}

type CatalogEntry struct {
	ID           string   `json:"id"`
	FullName     string   `json:"full_name"`
	URL          string   `json:"url"`
	Description  string   `json:"description,omitempty"`
	Stars        int      `json:"stargazers_count"`
	Topics       []string `json:"topics,omitempty"`
	PushedAt     string   `json:"pushed_at,omitempty"`
	Source       string   `json:"source"` // curated | catalogue
	NameZH       string   `json:"name_zh,omitempty"`
	NameEN       string   `json:"name_en,omitempty"`
	SummaryZH    string   `json:"summary_zh,omitempty"`
	SummaryEN    string   `json:"summary_en,omitempty"`
	KnownRisksZH string   `json:"known_risks_zh,omitempty"`
	KnownRisksEN string   `json:"known_risks_en,omitempty"`
}

type catalogueDiskFile struct {
	FetchedAt string         `json:"fetched_at"`
	Entries   []CatalogEntry `json:"entries"`
	LastError string         `json:"last_error,omitempty"`
}

type catalogueCache struct {
	mu         sync.Mutex
	dir        string
	entries    []CatalogEntry
	at         time.Time
	err        string
	loaded     bool
	refreshing bool
	stopCh     chan struct{}
	started    bool
}

var catCache catalogueCache

const (
	catalogueURL          = "https://www.azerothcore.org/data/catalogue.json"
	catalogueCacheFile    = "catalogue-modules.json"
	catalogueTTL          = 12 * time.Hour
	catalogueRefreshEvery = 6 * time.Hour
	catalogueHTTPTimeout  = 60 * time.Second
)

func LoadCurated(path string) ([]CuratedModule, error) {
	candidates := []string{path}
	if path == "" {
		candidates = []string{}
	}
	candidates = append(candidates,
		"data/modules/curated.json",
		"/app/data/modules/curated.json",
		"/data/modules/curated.json",
		"../data/modules/curated.json",
		"api/data/modules/curated.json",
	)
	var lastErr error
	seen := map[string]bool{}
	for _, p := range candidates {
		if p == "" {
			continue
		}
		abs, err := filepath.Abs(p)
		if err == nil {
			if seen[abs] {
				continue
			}
			seen[abs] = true
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			lastErr = err
			continue
		}
		var items []CuratedModule
		if err := json.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
		return items, nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("curated.json not found")
}

// ConfigureCatalogue sets the on-disk cache directory and loads any existing file.
// Call once at process start before serving HTTP.
func ConfigureCatalogue(cacheDir string) {
	catCache.mu.Lock()
	defer catCache.mu.Unlock()
	catCache.dir = strings.TrimSpace(cacheDir)
	catCache.loadLocked()
}

// StartCatalogueRefresher loads disk cache (if needed) and starts a background
// updater. Safe to call once; subsequent calls are no-ops.
func StartCatalogueRefresher(cacheDir string) {
	ConfigureCatalogue(cacheDir)
	catCache.mu.Lock()
	if catCache.started {
		catCache.mu.Unlock()
		return
	}
	catCache.started = true
	catCache.stopCh = make(chan struct{})
	catCache.mu.Unlock()

	// Immediate warm / refresh without blocking callers.
	go refreshCatalogue(false)

	go func() {
		ticker := time.NewTicker(catalogueRefreshEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				refreshCatalogue(false)
			case <-catCache.stopCh:
				return
			}
		}
	}()
}

// FetchCatalogue returns the local catalogue snapshot immediately.
// It never blocks on the remote HTTP fetch: force/stale/empty only schedules a
// background refresh. The second return value is a soft warning (last fetch error
// or empty-cache notice), not a hard failure when curated-only data remains usable.
func FetchCatalogue(client *http.Client, force bool) ([]CatalogEntry, string, error) {
	_ = client // reserved for tests / future injection via refreshCatalogueClient
	catCache.mu.Lock()
	catCache.loadLocked()
	entries := append([]CatalogEntry(nil), catCache.entries...)
	at := catCache.at
	lastErr := catCache.err
	empty := len(entries) == 0
	stale := empty || (!at.IsZero() && time.Since(at) > catalogueTTL)
	catCache.mu.Unlock()

	if force || stale {
		go refreshCatalogue(force)
	}

	warn := ""
	if empty {
		if lastErr != "" {
			warn = lastErr
		} else {
			warn = "catalogue cache empty; refreshing in background"
		}
		return entries, warn, nil
	}
	if lastErr != "" && stale {
		warn = lastErr
	}
	return entries, warn, nil
}

// CatalogueCachedAt returns when the in-memory/disk snapshot was last fetched.
func CatalogueCachedAt() time.Time {
	catCache.mu.Lock()
	defer catCache.mu.Unlock()
	catCache.loadLocked()
	return catCache.at
}

func catalogueCachePathLocked() string {
	if catCache.dir == "" {
		return ""
	}
	return filepath.Join(catCache.dir, catalogueCacheFile)
}

func (c *catalogueCache) loadLocked() {
	if c.loaded {
		return
	}
	c.loaded = true
	path := catalogueCachePathLocked()
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var disk catalogueDiskFile
	if err := json.Unmarshal(raw, &disk); err != nil {
		log.Printf("catalogue cache: parse %s: %v", path, err)
		return
	}
	c.entries = disk.Entries
	c.err = disk.LastError
	if t, err := time.Parse(time.RFC3339, disk.FetchedAt); err == nil {
		c.at = t
	}
}

func refreshCatalogue(force bool) {
	catCache.mu.Lock()
	if catCache.refreshing {
		catCache.mu.Unlock()
		return
	}
	if !force && len(catCache.entries) > 0 && !catCache.at.IsZero() && time.Since(catCache.at) < catalogueTTL {
		catCache.mu.Unlock()
		return
	}
	catCache.refreshing = true
	dir := catCache.dir
	catCache.mu.Unlock()

	defer func() {
		catCache.mu.Lock()
		catCache.refreshing = false
		catCache.mu.Unlock()
	}()

	entries, err := downloadCatalogue(nil)
	now := time.Now().UTC()

	catCache.mu.Lock()
	defer catCache.mu.Unlock()
	if err != nil {
		catCache.err = err.Error()
		log.Printf("catalogue refresh failed: %v", err)
		// Persist last error alongside existing entries so restarts keep warning context.
		_ = saveCatalogueDiskLocked(dir, catCache.entries, catCache.at, catCache.err)
		return
	}
	catCache.entries = entries
	catCache.at = now
	catCache.err = ""
	catCache.loaded = true
	if err := saveCatalogueDiskLocked(dir, entries, now, ""); err != nil {
		log.Printf("catalogue cache write: %v", err)
	} else {
		log.Printf("catalogue refreshed: %d modules", len(entries))
	}
}

func saveCatalogueDiskLocked(dir string, entries []CatalogEntry, at time.Time, lastErr string) error {
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	disk := catalogueDiskFile{
		FetchedAt: "",
		Entries:   entries,
		LastError: lastErr,
	}
	if !at.IsZero() {
		disk.FetchedAt = at.UTC().Format(time.RFC3339)
	}
	raw, err := json.MarshalIndent(disk, "", "  ")
	if err != nil {
		return err
	}
	tmp := filepath.Join(dir, catalogueCacheFile+".tmp")
	final := filepath.Join(dir, catalogueCacheFile)
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

func downloadCatalogue(client *http.Client) ([]CatalogEntry, error) {
	if client == nil {
		client = &http.Client{Timeout: catalogueHTTPTimeout}
	}
	ctx, cancel := context.WithTimeout(context.Background(), catalogueHTTPTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, catalogueURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AzerothCoreManage/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("catalogue http %d", resp.StatusCode)
	}
	var root any
	if err := json.NewDecoder(resp.Body).Decode(&root); err != nil {
		return nil, err
	}
	entries := extractCatalogueModules(root)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Stars > entries[j].Stars
	})
	return entries, nil
}

func extractCatalogueModules(node any) []CatalogEntry {
	seen := map[string]bool{}
	var out []CatalogEntry
	var walk func(any)
	walk = func(n any) {
		switch v := n.(type) {
		case map[string]any:
			full, _ := v["full_name"].(string)
			topicsAny, _ := v["topics"].([]any)
			hasTopic := false
			topics := []string{}
			for _, t := range topicsAny {
				if s, ok := t.(string); ok {
					topics = append(topics, s)
					if s == "azerothcore-module" {
						hasTopic = true
					}
				}
			}
			if full != "" && hasTopic && !seen[full] {
				seen[full] = true
				stars := 0
				switch s := v["stargazers_count"].(type) {
				case float64:
					stars = int(s)
				case int:
					stars = s
				}
				desc, _ := v["description"].(string)
				pushed, _ := v["pushed_at"].(string)
				id := full
				if i := strings.LastIndex(full, "/"); i >= 0 {
					id = full[i+1:]
				}
				out = append(out, CatalogEntry{
					ID:          id,
					FullName:    full,
					URL:         "https://github.com/" + full,
					Description: desc,
					Stars:       stars,
					Topics:      topics,
					PushedAt:    pushed,
					Source:      "catalogue",
				})
			}
			for _, child := range v {
				walk(child)
			}
		case []any:
			for _, child := range v {
				walk(child)
			}
		}
	}
	walk(node)
	return out
}

func MergeCatalog(curated []CuratedModule, catalogue []CatalogEntry, q string) []CatalogEntry {
	q = strings.ToLower(strings.TrimSpace(q))
	byFull := map[string]CatalogEntry{}
	for _, c := range catalogue {
		byFull[strings.ToLower(c.FullName)] = c
	}
	var out []CatalogEntry
	seen := map[string]bool{}
	for _, c := range curated {
		full := c.OwnerRepo
		e := CatalogEntry{
			ID:           c.ID,
			FullName:     full,
			URL:          c.URL,
			Source:       "curated",
			NameZH:       c.NameZH,
			NameEN:       c.NameEN,
			SummaryZH:    c.SummaryZH,
			SummaryEN:    c.SummaryEN,
			KnownRisksZH: c.KnownRisksZH,
			KnownRisksEN: c.KnownRisksEN,
		}
		if e.URL == "" && full != "" {
			e.URL = "https://github.com/" + full
		}
		if existing, ok := byFull[strings.ToLower(full)]; ok {
			e.Stars = existing.Stars
			e.Description = existing.Description
			e.Topics = existing.Topics
			e.PushedAt = existing.PushedAt
		}
		if q == "" || catalogMatch(e, q) {
			out = append(out, e)
			seen[strings.ToLower(full)] = true
			seen[strings.ToLower(e.ID)] = true
		}
	}
	for _, c := range catalogue {
		key := strings.ToLower(c.FullName)
		if seen[key] || seen[strings.ToLower(c.ID)] {
			continue
		}
		if q == "" || catalogMatch(c, q) {
			out = append(out, c)
		}
	}
	return out
}

// EnrichCatalogMeta fills pushed_at / stars from GitHub for entries missing them
// (common for curated modules that are absent from the official catalogue.json).
func EnrichCatalogMeta(ctx context.Context, gh *GitHubClient, items []CatalogEntry) []CatalogEntry {
	if gh == nil || len(items) == 0 {
		return items
	}
	type job struct {
		idx  int
		repo string
	}
	var jobs []job
	for i := range items {
		if items[i].Source != "curated" {
			continue
		}
		needPush := strings.TrimSpace(items[i].PushedAt) == ""
		needStars := items[i].Stars <= 0
		if !needPush && !needStars {
			continue
		}
		repo := strings.TrimSpace(items[i].FullName)
		if repo == "" || !strings.Contains(repo, "/") {
			continue
		}
		jobs = append(jobs, job{idx: i, repo: repo})
	}
	if len(jobs) == 0 {
		return items
	}

	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, j := range jobs {
		j := j
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case <-ctx.Done():
				return
			case sem <- struct{}{}:
			}
			defer func() { <-sem }()
			meta, err := gh.getJSON(ctx, "https://api.github.com/repos/"+j.repo)
			if err != nil {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			if items[j.idx].PushedAt == "" {
				if p, ok := meta["pushed_at"].(string); ok {
					items[j.idx].PushedAt = p
				}
			}
			if items[j.idx].Stars <= 0 {
				switch s := meta["stargazers_count"].(type) {
				case float64:
					items[j.idx].Stars = int(s)
				case int:
					items[j.idx].Stars = s
				}
			}
			if items[j.idx].Description == "" {
				if d, ok := meta["description"].(string); ok {
					items[j.idx].Description = d
				}
			}
		}()
	}
	wg.Wait()
	return items
}

func catalogMatch(e CatalogEntry, q string) bool {
	blob := strings.ToLower(strings.Join([]string{
		e.ID, e.FullName, e.Description, e.NameZH, e.NameEN, e.SummaryZH, e.SummaryEN,
	}, " "))
	return strings.Contains(blob, q)
}

func EnsureDir(path string) error {
	return os.MkdirAll(path, 0o755)
}

func CacheFile(cacheDir, name string) string {
	return filepath.Join(cacheDir, name)
}
