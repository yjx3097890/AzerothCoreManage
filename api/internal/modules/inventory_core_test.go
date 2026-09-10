package modules

import "testing"

func TestApplyConfiguredCore(t *testing.T) {
	core := &CoreInfo{}
	ApplyConfiguredCore(core, "AzerothCore rev. 9adba48abc+", "")
	if core.Revision != "9adba48abc" {
		t.Fatalf("revision=%q", core.Revision)
	}
	if core.Source != "config" {
		t.Fatalf("source=%q", core.Source)
	}

	core2 := &CoreInfo{Version: "from-soap", Revision: "abcdef1", Source: "soap"}
	ApplyConfiguredCore(core2, "should-not-override", "zzzzzzz")
	if core2.Version != "from-soap" || core2.Revision != "abcdef1" || core2.Source != "soap" {
		t.Fatalf("unexpected override: %+v", core2)
	}

	core3 := &CoreInfo{}
	ApplyConfiguredCore(core3, "${AC_CORE_VERSION}", "${AC_CORE_REVISION}")
	if core3.Version != "" || core3.Revision != "" {
		t.Fatalf("placeholder should be ignored: %+v", core3)
	}
}
