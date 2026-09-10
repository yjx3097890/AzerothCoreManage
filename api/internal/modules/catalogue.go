package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type CuratedModule struct {
	ID          string `json:"id"`
	OwnerRepo   string `json:"owner_repo"`
	URL         string `json:"url"`
	NameZH      string `json:"name_zh"`
	NameEN      string `json:"name_en"`
	SummaryZH   string `json:"summary_zh"`
	SummaryEN   string `json:"summary_en"`
	Tags        []string `json:"tags,omitempty"`
	KnownRisksZH string `json:"known_risks_zh,omitempty"`
	KnownRisksEN string `json:"known_risks_en,omitempty"`
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

type catalogueCache struct {
	mu      sync.Mutex
	entries []CatalogEntry
	at      time.Time
	err     string
}

var catCache catalogueCache

const catalogueURL = "https://www.azerothcore.org/data/catalogue.json"

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

func FetchCatalogue(client *http.Client, force bool) ([]CatalogEntry, string, error) {
	catCache.mu.Lock()
	defer catCache.mu.Unlock()
	if !force && len(catCache.entries) > 0 && time.Since(catCache.at) < 12*time.Hour {
		// Rebuild if older cache lacked pushed_at.
		if catCache.entries[0].PushedAt != "" || time.Since(catCache.at) < time.Minute {
			return catCache.entries, catCache.err, nil
		}
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := client.Get(catalogueURL)
	if err != nil {
		catCache.err = err.Error()
		if len(catCache.entries) > 0 {
			return catCache.entries, catCache.err, nil
		}
		return nil, catCache.err, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		catCache.err = fmt.Sprintf("catalogue http %d", resp.StatusCode)
		if len(catCache.entries) > 0 {
			return catCache.entries, catCache.err, nil
		}
		return nil, catCache.err, fmt.Errorf("%s", catCache.err)
	}
	var root any
	if err := json.NewDecoder(resp.Body).Decode(&root); err != nil {
		return nil, "", err
	}
	entries := extractCatalogueModules(root)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Stars > entries[j].Stars
	})
	catCache.entries = entries
	catCache.at = time.Now()
	catCache.err = ""
	return entries, "", nil
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
		idx int
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
