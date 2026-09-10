package modules

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type GitHubClient struct {
	Token  string
	HTTP   *http.Client
	cache  sync.Mutex
	memory map[string]cachedBlob
}

type cachedBlob struct {
	at   time.Time
	data []byte
}

type RepoMaterial struct {
	OwnerRepo        string       `json:"owner_repo"`
	DefaultBranch    string       `json:"default_branch,omitempty"`
	LatestCommit     string       `json:"latest_commit,omitempty"`
	LatestCommitDate string       `json:"latest_commit_date,omitempty"`
	ACoreModuleJSON  string       `json:"acore_module_json,omitempty"`
	Readme           string       `json:"readme,omitempty"`
	HasCMake         bool         `json:"has_cmake"`
	CMakeExcerpt     string       `json:"cmake_excerpt,omitempty"`
	SQLPaths         []string     `json:"sql_paths,omitempty"`
	ConfDist         []string     `json:"conf_dist,omitempty"`
	Issues           []IssueBrief `json:"issues,omitempty"`
	Topics           []string     `json:"topics,omitempty"`
	FetchErrors      []string     `json:"fetch_errors,omitempty"`
	RateLimited      bool         `json:"rate_limited,omitempty"`
}

type IssueBrief struct {
	Number    int      `json:"number"`
	Title     string   `json:"title"`
	State     string   `json:"state"`
	Labels    []string `json:"labels"`
	Comments  int      `json:"comments"`
	UpdatedAt string   `json:"updated_at"`
	Excerpt   string   `json:"body_excerpt"`
	URL       string   `json:"html_url"`
	Weight    int      `json:"weight,omitempty"`
}

func NewGitHubClient(token string) *GitHubClient {
	return &GitHubClient{
		Token:  token,
		HTTP:   &http.Client{Timeout: 25 * time.Second},
		memory: map[string]cachedBlob{},
	}
}

func (g *GitHubClient) FetchRepoMaterial(ctx context.Context, ownerRepo, ref string, installedIDs []string, coreRev string) (*RepoMaterial, error) {
	m := &RepoMaterial{OwnerRepo: ownerRepo}
	meta, err := g.getJSON(ctx, "https://api.github.com/repos/"+ownerRepo)
	if err != nil {
		m.FetchErrors = append(m.FetchErrors, "repo: "+err.Error())
		if isRateLimit(err) {
			m.RateLimited = true
		}
		return m, err
	}
	if v, ok := meta["default_branch"].(string); ok {
		m.DefaultBranch = v
	}
	if topics, ok := meta["topics"].([]any); ok {
		for _, t := range topics {
			if s, ok := t.(string); ok {
				m.Topics = append(m.Topics, s)
			}
		}
	}
	branch := ref
	if branch == "" {
		branch = m.DefaultBranch
	}
	if branch == "" {
		branch = "master"
	}

	if raw, err := g.getRaw(ctx, ownerRepo, branch, "acore-module.json"); err == nil {
		m.ACoreModuleJSON = string(raw)
	} else {
		m.FetchErrors = append(m.FetchErrors, "acore-module.json: "+err.Error())
	}

	readmeParts := []string{}
	for _, name := range []string{"README.md", "README.zh.md", "README.zh-CN.md", "readme.md"} {
		if raw, err := g.getRaw(ctx, ownerRepo, branch, name); err == nil && len(raw) > 0 {
			readmeParts = append(readmeParts, string(raw))
		}
	}
	m.Readme = truncateJoin(readmeParts, 24*1024)

	if raw, err := g.getRaw(ctx, ownerRepo, branch, "CMakeLists.txt"); err == nil {
		m.HasCMake = true
		m.CMakeExcerpt = truncate(string(raw), 2*1024)
	}

	m.SQLPaths = g.listTreePaths(ctx, ownerRepo, branch, "data/sql")
	m.ConfDist = g.listConfDist(ctx, ownerRepo, branch)

	issues, rateLimited, ierr := g.fetchIssues(ctx, ownerRepo, installedIDs, coreRev)
	if ierr != nil {
		m.FetchErrors = append(m.FetchErrors, "issues: "+ierr.Error())
	}
	m.Issues = issues
	if rateLimited {
		m.RateLimited = true
	}

	if commit, err := g.getJSON(ctx, "https://api.github.com/repos/"+ownerRepo+"/commits/"+branch); err == nil {
		if sha, ok := commit["sha"].(string); ok {
			if len(sha) > 12 {
				sha = sha[:12]
			}
			m.LatestCommit = sha
		}
		if commitObj, ok := commit["commit"].(map[string]any); ok {
			if committer, ok := commitObj["committer"].(map[string]any); ok {
				if d, ok := committer["date"].(string); ok {
					m.LatestCommitDate = d
				}
			}
			if m.LatestCommitDate == "" {
				if author, ok := commitObj["author"].(map[string]any); ok {
					if d, ok := author["date"].(string); ok {
						m.LatestCommitDate = d
					}
				}
			}
		}
	}
	return m, nil
}

func (g *GitHubClient) FetchIssuesOnly(ctx context.Context, ownerRepo string, installedIDs []string, coreRev string) ([]IssueBrief, bool, error) {
	return g.fetchIssues(ctx, ownerRepo, installedIDs, coreRev)
}

func (g *GitHubClient) fetchIssues(ctx context.Context, ownerRepo string, installedIDs []string, coreRev string) ([]IssueBrief, bool, error) {
	open, err1 := g.listIssues(ctx, ownerRepo, "open", 20)
	closed, err2 := g.listIssues(ctx, ownerRepo, "closed", 10)
	rateLimited := isRateLimit(err1) || isRateLimit(err2)
	if err1 != nil && err2 != nil {
		return nil, rateLimited, err1
	}
	byNum := map[int]IssueBrief{}
	for _, it := range open {
		byNum[it.Number] = it
	}
	// high comments from open
	sort.Slice(open, func(i, j int) bool { return open[i].Comments > open[j].Comments })
	for i, it := range open {
		if i >= 10 {
			break
		}
		byNum[it.Number] = it
	}
	for _, it := range closed {
		byNum[it.Number] = it
	}
	var all []IssueBrief
	for _, it := range byNum {
		it.Weight = issueWeight(it, installedIDs, coreRev)
		all = append(all, it)
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Weight != all[j].Weight {
			return all[i].Weight > all[j].Weight
		}
		return all[i].UpdatedAt > all[j].UpdatedAt
	})
	if len(all) > 40 {
		all = all[:40]
	}
	return all, rateLimited, nil
}

func issueWeight(it IssueBrief, installed []string, coreRev string) int {
	w := 0
	blob := strings.ToLower(it.Title + " " + it.Excerpt + " " + strings.Join(it.Labels, " "))
	keywords := []string{"crash", "compile", "cmake", "link", "sql", "duplicate", "conflict", "playerbots", "segfault", "build"}
	for _, k := range keywords {
		if strings.Contains(blob, k) {
			w += 3
		}
	}
	if it.State == "open" {
		w += 2
	}
	w += min(it.Comments, 10)
	coreRev = strings.ToLower(coreRev)
	if coreRev != "" && len(coreRev) >= 6 && strings.Contains(blob, coreRev[:6]) {
		w += 5
	}
	for _, id := range installed {
		id = strings.ToLower(id)
		if id != "" && strings.Contains(blob, id) {
			w += 4
		}
	}
	return w
}

func (g *GitHubClient) listIssues(ctx context.Context, ownerRepo, state string, perPage int) ([]IssueBrief, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/issues?state=%s&sort=updated&per_page=%d", ownerRepo, state, perPage)
	raw, err := g.getBytes(ctx, url)
	if err != nil {
		return nil, err
	}
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil, err
	}
	var out []IssueBrief
	for _, it := range arr {
		// skip PRs
		if _, ok := it["pull_request"]; ok {
			continue
		}
		brief := IssueBrief{}
		if n, ok := it["number"].(float64); ok {
			brief.Number = int(n)
		}
		brief.Title, _ = it["title"].(string)
		brief.State, _ = it["state"].(string)
		brief.URL, _ = it["html_url"].(string)
		brief.UpdatedAt, _ = it["updated_at"].(string)
		if c, ok := it["comments"].(float64); ok {
			brief.Comments = int(c)
		}
		if body, ok := it["body"].(string); ok {
			brief.Excerpt = truncate(body, 600)
		}
		if labels, ok := it["labels"].([]any); ok {
			for _, l := range labels {
				if lm, ok := l.(map[string]any); ok {
					if name, ok := lm["name"].(string); ok {
						brief.Labels = append(brief.Labels, name)
					}
				}
			}
		}
		out = append(out, brief)
	}
	return out, nil
}

func (g *GitHubClient) listTreePaths(ctx context.Context, ownerRepo, branch, prefix string) []string {
	url := fmt.Sprintf("https://api.github.com/repos/%s/git/trees/%s?recursive=1", ownerRepo, branch)
	raw, err := g.getBytes(ctx, url)
	if err != nil {
		return nil
	}
	var tree struct {
		Tree []struct {
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"tree"`
	}
	if err := json.Unmarshal(raw, &tree); err != nil {
		return nil
	}
	var out []string
	for _, t := range tree.Tree {
		if t.Type == "blob" && strings.HasPrefix(t.Path, prefix) && strings.HasSuffix(strings.ToLower(t.Path), ".sql") {
			out = append(out, t.Path)
			if len(out) >= 80 {
				break
			}
		}
	}
	return out
}

func (g *GitHubClient) listConfDist(ctx context.Context, ownerRepo, branch string) []string {
	url := fmt.Sprintf("https://api.github.com/repos/%s/contents/conf?ref=%s", ownerRepo, branch)
	raw, err := g.getBytes(ctx, url)
	if err != nil {
		return nil
	}
	var arr []map[string]any
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil
	}
	var out []string
	for _, it := range arr {
		name, _ := it["name"].(string)
		if strings.HasSuffix(name, ".conf.dist") || strings.HasSuffix(name, ".conf") {
			out = append(out, "conf/"+name)
		}
	}
	return out
}

func (g *GitHubClient) getRaw(ctx context.Context, ownerRepo, branch, path string) ([]byte, error) {
	url := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", ownerRepo, branch, path)
	return g.getBytes(ctx, url)
}

func (g *GitHubClient) getJSON(ctx context.Context, url string) (map[string]any, error) {
	raw, err := g.getBytes(ctx, url)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	return m, nil
}

func (g *GitHubClient) getBytes(ctx context.Context, url string) ([]byte, error) {
	g.cache.Lock()
	if c, ok := g.memory[url]; ok && time.Since(c.at) < 6*time.Hour {
		data := append([]byte{}, c.data...)
		g.cache.Unlock()
		return data, nil
	}
	g.cache.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "acmanage-module-manager")
	if g.Token != "" {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}
	resp, err := g.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == 403 || resp.StatusCode == 429 {
		return nil, fmt.Errorf("github_rate_limited: %s", truncate(string(body), 200))
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("github http %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	g.cache.Lock()
	g.memory[url] = cachedBlob{at: time.Now(), data: append([]byte{}, body...)}
	g.cache.Unlock()
	return body, nil
}

func isRateLimit(err error) bool {
	return err != nil && strings.Contains(err.Error(), "github_rate_limited")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

func truncateJoin(parts []string, n int) string {
	s := strings.Join(parts, "\n\n---\n\n")
	return truncate(s, n)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
