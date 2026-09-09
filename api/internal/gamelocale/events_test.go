package gamelocale

import (
	"strings"
	"testing"

	"acmanage/internal/i18n"
)

func TestParseActiveListZH(t *testing.T) {
	raw := `4 - Darkmoon Faire (Elwynn Forest)  [active]
16 - Gurubashi Arena Booty Run  [active]
45 - Brew of the Month September  [active]
119 - SWP - All Gates Open  [active]
`
	items := ParseActiveList(raw, i18n.ZH)
	if len(items) != 4 {
		t.Fatalf("want 4 items, got %d", len(items))
	}
	if items[0].Name != "暗月马戏团（艾尔文森林）" {
		t.Fatalf("event 4: got %q", items[0].Name)
	}
	if items[1].Name != "古拉巴什竞技场夺宝" {
		t.Fatalf("event 16: got %q", items[1].Name)
	}
	if items[2].Name != "本月美酒（九月）" {
		t.Fatalf("event 45: got %q", items[2].Name)
	}
	if !items[0].Active {
		t.Fatal("expected active")
	}
}

func TestParseActiveListEN(t *testing.T) {
	raw := `4 - Darkmoon Faire (Elwynn Forest)  [active]`
	items := ParseActiveList(raw, i18n.EN)
	if len(items) != 1 || items[0].Name != "Darkmoon Faire (Elwynn Forest)" {
		t.Fatalf("unexpected: %+v", items)
	}
}

func TestMapAreaLocale(t *testing.T) {
	if got := MapName(0, i18n.EN); got != "Eastern Kingdoms" {
		t.Fatalf("map0 en: %q", got)
	}
	if got := MapName(0, i18n.ZH); got != "东部王国" {
		t.Fatalf("map0 zh: %q", got)
	}
	if got := AreaName(12, i18n.EN); got != "Elwynn Forest" {
		t.Fatalf("area12 en: %q", got)
	}
	if got := AreaName(12, i18n.ZH); got != "艾尔文森林" {
		t.Fatalf("area12 zh: %q", got)
	}
}

func TestDisableLabels(t *testing.T) {
	if got := DisableSourceName(0, i18n.ZH); got != "法术" {
		t.Fatalf("source zh: %q", got)
	}
	if got := DisableFlagsText(0, 64|8, i18n.ZH); !strings.Contains(got, "忽略视线") || !strings.Contains(got, "完全禁用") {
		t.Fatalf("flags zh: %q", got)
	}
	if got := LocalizeDisableComment("Spell for deprecated item 1254", i18n.ZH); got != "废弃物品 1254 的法术" {
		t.Fatalf("comment: %q", got)
	}
	if got := LocalizeDisableComment("Deprecated quest: Foo", i18n.ZH); got != "废弃任务：Foo" {
		t.Fatalf("quest comment: %q", got)
	}
}
