package gamelocale

import (
	"testing"

	"acmanage/internal/i18n"
)

func TestTeleNameZH(t *testing.T) {
	cases := map[string]string{
		"Stormwind":    "暴风城",
		"Orgrimmar":    "奥格瑞玛",
		"ElwynnForest": "艾尔文森林",
		"Goldshire":    "闪金镇",
	}
	for en, want := range cases {
		if got := TeleNameZH(en); got != want {
			t.Fatalf("TeleNameZH(%q)=%q want %q", en, got, want)
		}
	}
	if TeleNameMatches("Stormwind", "暴风") != true {
		t.Fatal("expected Chinese needle to match Stormwind")
	}
	if TeleDisplayName("Stormwind", i18n.ZH) != "暴风城" {
		t.Fatal("expected ZH display name")
	}
}
