package acmd

import "testing"

func TestGuardAllowAndDeny(t *testing.T) {
	g := New([]string{"server info", "playerbot rndbot", "ban"}, []string{"playerbot rndbot revive", "playerbot rndbot grind"})

	if err := g.Check("server info"); err != nil {
		t.Fatal(err)
	}
	if err := g.Check("playerbot rndbot stats"); err != nil {
		t.Fatal(err)
	}
	if err := g.Check("playerbot rndbot revive"); err == nil {
		t.Fatal("expected revive to be denied")
	}
	if err := g.Check("lookup item sword"); err == nil {
		t.Fatal("expected unknown command to be rejected")
	}
}
