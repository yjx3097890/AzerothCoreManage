package modules

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindConfForModulePrefersPlayerbotsConf(t *testing.T) {
	root := t.TempDir()
	etc := filepath.Join(root, "etc", "modules")
	if err := os.MkdirAll(etc, 0o755); err != nil {
		t.Fatal(err)
	}
	stub := filepath.Join(etc, "playerbots.conf")
	if err := os.WriteFile(stub, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	real := filepath.Join(root, "conf", "modules", "playerbots.conf")
	if err := os.MkdirAll(filepath.Dir(real), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(real, []byte("AiPlayerbot.Enabled = 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got, ok := FindConfForModule(Paths{
		EtcModulesDir:  etc,
		PlayerbotsConf: real,
	}, "mod-playerbots")
	if !ok {
		t.Fatal("expected conf")
	}
	if got.Path != real {
		t.Fatalf("path = %q, want %q", got.Path, real)
	}
	if got.Size == 0 {
		t.Fatal("expected non-empty size")
	}
}
