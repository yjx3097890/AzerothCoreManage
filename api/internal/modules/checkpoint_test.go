package modules

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"acmanage/internal/config"
)

func TestIsSafeCheckpointID(t *testing.T) {
	ok := []string{"20260910-141500-a1b2", "20260101-000000-ffff"}
	bad := []string{"", "../x", "a/b", "has space", "id;rm"}
	for _, id := range ok {
		if !IsSafeCheckpointID(id) {
			t.Fatalf("expected safe: %q", id)
		}
	}
	for _, id := range bad {
		if IsSafeCheckpointID(id) {
			t.Fatalf("expected unsafe: %q", id)
		}
	}
}

func TestCheckpointListPrune(t *testing.T) {
	base := t.TempDir()
	target := "lan"
	for i := 0; i < 3; i++ {
		id := fmt.Sprintf("20260910-14000%d-aa0%d", i, i)
		dir := filepath.Join(base, id)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		meta := CheckpointMeta{
			ID:        id,
			TargetID:  target,
			CreatedAt: time.Date(2026, 9, 10, 14, i, 0, 0, time.UTC),
			Deploy:    "docker",
			SQLFiles:  []string{"world"},
			Note:      "test",
		}
		b, _ := json.Marshal(meta)
		if err := os.WriteFile(filepath.Join(dir, "meta.json"), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	items, err := List(base, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 {
		t.Fatalf("want 3 got %d", len(items))
	}
	if err := Prune(t.Context(), base, target, 2, nil); err != nil {
		t.Fatal(err)
	}
	items, err = List(base, target)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("after prune want 2 got %d", len(items))
	}
}

func TestListCoreConfSnapshots(t *testing.T) {
	root := t.TempDir()
	ws := filepath.Join(root, "worldserver.conf")
	as := filepath.Join(root, "authserver.conf")
	ov := filepath.Join(root, "docker-compose.override.yml")
	pb := filepath.Join(root, "playerbots.conf")
	for _, p := range []string{ws, as, ov, pb} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	tgt := &config.Target{
		Conf: config.ConfPaths{
			WorldserverConf: ws,
			AuthserverConf:  as,
			PlayerbotsConf:  pb,
		},
		Modules: config.Modules{ComposeDir: root},
	}
	got := ListCoreConfSnapshots(tgt)
	if len(got) != 4 {
		t.Fatalf("want 4 got %d", len(got))
	}
	ids := map[string]bool{}
	for _, c := range got {
		ids[c.ID] = true
		if c.LivePath == "" || c.StoreAs == "" {
			t.Fatalf("incomplete %#v", c)
		}
	}
	for _, id := range []string{"worldserver", "authserver", "compose_override", "playerbots"} {
		if !ids[id] {
			t.Fatalf("missing %s", id)
		}
	}
}
