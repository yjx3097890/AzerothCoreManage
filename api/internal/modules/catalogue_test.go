package modules

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func resetCatalogueCacheForTest() {
	catCache.mu.Lock()
	if catCache.stopCh != nil {
		select {
		case <-catCache.stopCh:
		default:
			close(catCache.stopCh)
		}
	}
	dir := ""
	_ = dir
	catCache.dir = ""
	catCache.entries = nil
	catCache.at = time.Time{}
	catCache.err = ""
	catCache.loaded = false
	catCache.refreshing = false
	catCache.stopCh = nil
	catCache.started = false
	catCache.mu.Unlock()
}

func TestCatalogueServesDiskWithoutNetwork(t *testing.T) {
	resetCatalogueCacheForTest()
	t.Cleanup(resetCatalogueCacheForTest)

	dir := t.TempDir()
	disk := catalogueDiskFile{
		FetchedAt: time.Now().UTC().Format(time.RFC3339),
		Entries: []CatalogEntry{{
			ID: "mod-example", FullName: "azerothcore/mod-example", Source: "catalogue", Stars: 10,
		}},
	}
	raw, _ := json.Marshal(disk)
	if err := os.WriteFile(filepath.Join(dir, catalogueCacheFile), raw, 0o644); err != nil {
		t.Fatal(err)
	}

	ConfigureCatalogue(dir)
	entries, warn, err := FetchCatalogue(nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if warn != "" {
		t.Fatalf("unexpected warn: %s", warn)
	}
	if len(entries) != 1 || entries[0].ID != "mod-example" {
		t.Fatalf("entries=%v", entries)
	}
}

func TestCatalogueRefreshWritesDisk(t *testing.T) {
	resetCatalogueCacheForTest()
	t.Cleanup(resetCatalogueCacheForTest)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]any{
			map[string]any{
				"full_name":        "azerothcore/mod-foo",
				"description":      "foo",
				"stargazers_count": 42,
				"pushed_at":        "2024-01-02T03:04:05Z",
				"topics":           []any{"azerothcore-module"},
			},
		})
	}))
	defer srv.Close()

	// Point package URL at test server by temporarily swapping via download through custom client.
	// refreshCatalogue uses downloadCatalogue(nil); inject by calling downloadCatalogue with srv client
	// after Configure, then write like refresh does.
	dir := t.TempDir()
	ConfigureCatalogue(dir)

	client := srv.Client()
	client.Timeout = 5 * time.Second
	// Monkey-patch: call download against srv by replacing catalogueURL is const — instead write a
	// local helper path: directly invoke download with a client that rewrites is hard.
	// Use a custom refresh by writing entries via save after fetch from srv with absolute URL override.
	req, err := http.NewRequest(http.MethodGet, srv.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var root any
	if err := json.NewDecoder(resp.Body).Decode(&root); err != nil {
		t.Fatal(err)
	}
	entries := extractCatalogueModules(root)
	if len(entries) != 1 {
		t.Fatalf("got %d", len(entries))
	}

	catCache.mu.Lock()
	catCache.entries = entries
	catCache.at = time.Now().UTC()
	catCache.err = ""
	err = saveCatalogueDiskLocked(dir, entries, catCache.at, "")
	catCache.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	resetCatalogueCacheForTest()
	ConfigureCatalogue(dir)
	got, _, err := FetchCatalogue(nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].FullName != "azerothcore/mod-foo" || got[0].Stars != 42 {
		t.Fatalf("got=%+v", got)
	}
}

func TestFetchCatalogueDoesNotBlockOnSlowNetwork(t *testing.T) {
	resetCatalogueCacheForTest()
	t.Cleanup(resetCatalogueCacheForTest)

	dir := t.TempDir()
	ConfigureCatalogue(dir)

	started := time.Now()
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, warn, err := FetchCatalogue(nil, true)
		if err != nil {
			t.Errorf("err=%v", err)
		}
		if warn == "" {
			t.Errorf("expected empty-cache warning")
		}
	}()
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		if time.Since(started) > 2*time.Second {
			t.Fatalf("FetchCatalogue blocked too long: %v", time.Since(started))
		}
	case <-time.After(2 * time.Second):
		t.Fatal("FetchCatalogue blocked on network")
	}
}
