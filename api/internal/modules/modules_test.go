package modules

import (
	"testing"
)

func TestParseGitHubSpec(t *testing.T) {
	or, ref, url, err := ParseGitHubSpec("azerothcore/mod-transmog@main", nil)
	if err != nil || or != "azerothcore/mod-transmog" || ref != "main" || url == "" {
		t.Fatalf("got %q %q %q %v", or, ref, url, err)
	}
	or, _, _, err = ParseGitHubSpec("https://github.com/azerothcore/mod-transmog.git", []string{"github.com"})
	if err != nil || or != "azerothcore/mod-transmog" {
		t.Fatalf("url parse: %q %v", or, err)
	}
	_, _, _, err = ParseGitHubSpec("https://evil.example/a/b", []string{"github.com"})
	if err == nil {
		t.Fatal("expected host reject")
	}
}

func TestParseServerDebug(t *testing.T) {
	raw := `
Server Debug Info
Loaded modules:
- Transmogrification
- mod-anticheat
Using MySQL
`
	m := ParseServerDebug(raw)
	if m == nil || len(m) == 0 {
		t.Fatal("expected modules")
	}
}

func TestIsSafeModuleID(t *testing.T) {
	if !IsSafeModuleID("mod-transmog") || IsSafeModuleID("../x") || IsSafeModuleID("") {
		t.Fatal("safe id checks failed")
	}
}

func TestOwnerRepoFromRemote(t *testing.T) {
	if OwnerRepoFromRemote("https://github.com/azerothcore/mod-transmog.git") != "azerothcore/mod-transmog" {
		t.Fatal("remote parse")
	}
}
