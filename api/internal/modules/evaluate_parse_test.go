package modules

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseModelEvaluationLoose(t *testing.T) {
	raw := json.RawMessage(`{
		"verdict": "OK",
		"compat_score": "82",
		"ac_version_match": "unknown",
		"version_note": "无精确 revision",
		"features_zh": "自动在拍卖行上架物品，填充服务器经济。",
		"advice": "可以试装，但请先打检查点。",
		"needs_rebuild": true,
		"needs_sql": "yes",
		"risks": "owner 不在白名单",
		"steps": ["clone 模块", {"title": "重建", "command": "docker compose up -d --build"}],
		"issue_findings": [{"number": 1, "title": "compile fail"}]
	}`)
	ev, err := parseModelEvaluation(raw, "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if ev.Verdict != "ok" {
		t.Fatalf("verdict=%q", ev.Verdict)
	}
	if ev.CompatScore != 82 {
		t.Fatalf("score=%d", ev.CompatScore)
	}
	if ev.FeaturesZH == "" {
		t.Fatal("expected features_zh")
	}
	if ev.Summary == "" {
		t.Fatal("expected summary from advice")
	}
	if !ev.NeedsSQL {
		t.Fatal("expected needs_sql")
	}
	if len(ev.Steps) != 2 {
		t.Fatalf("steps=%d", len(ev.Steps))
	}
	if len(ev.IssueFindings) != 1 || ev.IssueFindings[0].Summary == "" {
		t.Fatalf("findings=%v", ev.IssueFindings)
	}
}

func TestParseModelEvaluationIgnoresEnglishFeaturesOnZH(t *testing.T) {
	raw := json.RawMessage(`{
		"verdict": "caution",
		"compat_score": 50,
		"features_en": "This module adds transmogrification for gear appearances.",
		"features_zh": "",
		"summary": "Can try after a checkpoint."
	}`)
	ev, err := parseModelEvaluation(raw, "zh-CN")
	if err != nil {
		t.Fatal(err)
	}
	if ev.FeaturesZH != "" {
		t.Fatalf("expected empty features for zh when only features_en present, got %q", ev.FeaturesZH)
	}
}

func TestHeuristicFeaturesZHPrefersCuratedZH(t *testing.T) {
	got := heuristicFeatures(EvaluateInput{
		Locale:           "zh-CN",
		CuratedSummaryZH: "中文简介",
		CuratedSummaryEN: "English blurb",
		Material:         &RepoMaterial{Readme: "This is a long English README paragraph about the module features."},
	})
	if got != "中文简介" {
		t.Fatalf("got %q", got)
	}
}

func TestHeuristicFeaturesSkipsMarkdownTables(t *testing.T) {
	readme := `# Mod Foo

| Requirement | Version |
|-------------|---------|
| Python | 3.10+ |
| Go | 1.22 |

This module lets players transmogrify gear appearances on your AzerothCore realm.

## Install

1. Configure** the conf file
2. Rebuild worldserver
`
	got := heuristicFeatures(EvaluateInput{
		Locale:   "en-US",
		Material: &RepoMaterial{Readme: readme},
	})
	if strings.Contains(got, "|") || strings.Contains(got, "---") || strings.Contains(got, "Python") {
		t.Fatalf("table junk leaked into features: %q", got)
	}
	if !strings.Contains(strings.ToLower(got), "transmogrify") && !strings.Contains(strings.ToLower(got), "appearances") {
		t.Fatalf("expected prose feature blurb, got %q", got)
	}
}

func TestHeuristicFeaturesZHFallsBackToEnglishProse(t *testing.T) {
	readme := `
|-------------|---------|
| Python | 3.10+ |

Playerbots adds AI-controlled party members that can quest and dungeon with you.
`
	got := heuristicFeatures(EvaluateInput{
		Locale:   "zh-CN",
		Material: &RepoMaterial{Readme: readme},
	})
	if strings.Contains(got, "|") || strings.Contains(got, "Python") {
		t.Fatalf("expected no table junk, got %q", got)
	}
	if !strings.Contains(got, "Playerbots") && !strings.Contains(got, "AI") {
		t.Fatalf("expected English prose fallback, got %q", got)
	}
}

func TestIsJunkFeatureBlurb(t *testing.T) {
	junk := "|-------------|---------| | Python | 3.10+ | 1. Configure**"
	if !isJunkFeatureBlurb(junk) {
		t.Fatal("expected junk")
	}
	if isJunkFeatureBlurb("自动在拍卖行上架物品，填充服务器经济。") {
		t.Fatal("expected clean Chinese blurb")
	}
}

func TestApplyRuleOverlayIgnoresModelAlreadyInstalled(t *testing.T) {
	ev := &Evaluation{
		Verdict:          "ok",
		AlreadyInstalled: true,
		Summary:          "本机已安装该模块。可以继续评估兼容性。",
		Risks:            []string{"本机已安装 mod-ah-bot（commit abc）", "需重建核心"},
		FeaturesZH:       "自动在拍卖行上架物品，填充服务器经济。",
		CompatScore:      80,
	}
	applyRuleOverlay(ev, EvaluateInput{
		ModuleID:    "mod-ah-bot",
		OwnerRepo:   "azerothcore/mod-ah-bot",
		InventoryOK: true,
		Installed: []InstalledModule{
			{ID: "mod-playerbots", OwnerRepo: "liyunfan1223/mod-playerbots", Commit: "deadbeef"},
		},
		Material: &RepoMaterial{Readme: "x", HasCMake: true},
	})
	if ev.AlreadyInstalled {
		t.Fatal("expected already_installed=false when inventory has only playerbots")
	}
	for _, r := range ev.Risks {
		if claimsAlreadyInstalled(r) {
			t.Fatalf("risk still claims install: %q", r)
		}
	}
	if claimsAlreadyInstalled(ev.Summary) {
		t.Fatalf("summary still claims install: %q", ev.Summary)
	}
}

func TestMergeModelEvalSkipsJunkFeatures(t *testing.T) {
	dst := &Evaluation{FeaturesZH: "精选中文简介，说明模块用途。"}
	src := &Evaluation{
		FeaturesZH:       "|-------------|---------| | Python | 3.10+ | 1. Configure**",
		AlreadyInstalled: true,
		Summary:          "ok",
	}
	mergeModelEval(dst, src)
	if dst.AlreadyInstalled {
		t.Fatal("must not take already_installed from model")
	}
	if strings.Contains(dst.FeaturesZH, "|") {
		t.Fatalf("junk features merged: %q", dst.FeaturesZH)
	}
}

func TestMostlyLatin(t *testing.T) {
	if !mostlyLatin("This module automatically stocks the auction house with items for your server economy.") {
		t.Fatal("expected latin")
	}
	if mostlyLatin("自动在拍卖行上架物品，填充服务器经济。") {
		t.Fatal("expected not latin")
	}
}
