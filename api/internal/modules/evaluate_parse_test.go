package modules

import (
	"encoding/json"
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
	ev, err := parseModelEvaluation(raw)
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
