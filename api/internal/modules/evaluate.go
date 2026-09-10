package modules

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"acmanage/internal/deepseek"
)

type Evaluation struct {
	Verdict          string         `json:"verdict"` // ok | caution | no
	CompatScore      int            `json:"compat_score"`
	ACVersionMatch   string         `json:"ac_version_match"`
	VersionNote      string         `json:"version_note,omitempty"`
	FeaturesZH       string         `json:"features_zh,omitempty"`
	Summary          string         `json:"summary,omitempty"`
	NeedsRebuild     bool           `json:"needs_rebuild"`
	NeedsSQL         bool           `json:"needs_sql"`
	NeedsClientPatch bool           `json:"needs_client_patch"`
	AlreadyInstalled bool           `json:"already_installed,omitempty"`
	InventoryOK      bool           `json:"inventory_ok"`
	Conflicts        []string       `json:"conflicts"`
	IssueFindings    []IssueFinding `json:"issue_findings"`
	Risks            []string       `json:"risks"`
	Steps            []EvalStep     `json:"steps"`
	MissingEvidence  []string       `json:"missing_evidence"`
	Citations        []string       `json:"citations"`
	Degraded         bool           `json:"degraded,omitempty"`
	DegradedReason   string         `json:"degraded_reason,omitempty"`
	ModelUsed        bool           `json:"model_used"`
	EvaluatedAt      time.Time      `json:"evaluated_at"`
	CacheKey         string         `json:"cache_key,omitempty"`
	ModuleID         string         `json:"module_id"`
	OwnerRepo        string         `json:"owner_repo"`
	CoreRevision     string         `json:"core_revision,omitempty"`
	CoreVersion      string         `json:"core_version,omitempty"`
	LatestCommitDate string         `json:"latest_commit_date,omitempty"`
}

type IssueFinding struct {
	Number   int    `json:"number"`
	Severity string `json:"severity"`
	Summary  string `json:"summary"`
}

type EvalStep struct {
	Title   string `json:"title"`
	Command string `json:"command,omitempty"`
	Source  string `json:"source,omitempty"`
	Phase   string `json:"phase,omitempty"`
}

type EvaluateInput struct {
	Locale           string
	ModuleID         string
	OwnerRepo        string
	Ref              string
	AllowOwners      []string
	Core             CoreInfo
	Installed        []InstalledModule
	InventoryOK      bool // false when modules_dir is not readable — do not treat Installed as authoritative empty
	Material         *RepoMaterial
	CuratedSummaryZH string
	CuratedSummaryEN string
	DS               *deepseek.Client
	CacheDir         string
	Force            bool
}

func Evaluate(ctx context.Context, in EvaluateInput) (*Evaluation, error) {
	cacheKey := evalCacheKey(in)
	if !in.Force && in.CacheDir != "" {
		if ev, ok := loadEvalCache(in.CacheDir, cacheKey); ok && !ev.Degraded {
			return ev, nil
		}
	}

	ev := &Evaluation{
		Verdict:         "caution",
		ACVersionMatch:  "unknown",
		NeedsRebuild:    true,
		InventoryOK:     in.InventoryOK,
		Conflicts:       []string{},
		IssueFindings:   []IssueFinding{},
		Risks:           []string{},
		Steps:           []EvalStep{},
		MissingEvidence: []string{},
		Citations:       []string{},
		EvaluatedAt:     time.Now().UTC(),
		CacheKey:        cacheKey,
		ModuleID:        in.ModuleID,
		OwnerRepo:       in.OwnerRepo,
		CoreRevision:    in.Core.Revision,
		CoreVersion:     in.Core.Version,
	}
	if in.Material != nil {
		ev.LatestCommitDate = in.Material.LatestCommitDate
	}

	if in.Material == nil {
		ev.Degraded = true
		ev.DegradedReason = "evaluate_degraded"
		ev.MissingEvidence = append(ev.MissingEvidence, "repo_material")
		ev.Summary = localeText(in.Locale, "未能获取仓库材料，无法完成评估。", "Could not fetch repository materials; evaluation incomplete.")
		ev.CompatScore = 20
		return ev, nil
	}
	if in.Material.RateLimited {
		ev.Degraded = true
		ev.DegradedReason = "github_rate_limited"
		ev.Risks = append(ev.Risks, localeText(in.Locale, "GitHub API 限流，材料可能不完整", "GitHub API rate-limited; evidence may be incomplete"))
	}
	if strings.TrimSpace(in.Material.Readme) == "" {
		ev.MissingEvidence = append(ev.MissingEvidence, "README")
	}
	if strings.TrimSpace(in.Material.ACoreModuleJSON) == "" {
		ev.MissingEvidence = append(ev.MissingEvidence, "acore-module.json")
	}
	if strings.TrimSpace(in.Core.Revision) == "" && strings.TrimSpace(in.Core.Version) == "" {
		ev.MissingEvidence = appendUnique(ev.MissingEvidence, "local_core_version")
		ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
			"未能探测本机 AzerothCore 版本（SOAP server info / AC_ROOT git 不可用），版本匹配只能标为未知",
			"Local AzerothCore version could not be detected (SOAP / AC_ROOT git unavailable); version match stays unknown"))
	}
	if !in.InventoryOK {
		ev.MissingEvidence = appendUnique(ev.MissingEvidence, "local_modules_inventory")
		ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
			"本机 modules 目录不可访问：评分仅基于仓库材料与核心版本，未计入已装模块冲突（与能读到 modules 的环境分数可能不同）",
			"Local modules directory is unreachable: score is based on repo evidence + core only; installed conflicts are not applied (scores may differ from hosts that can read modules/)"))
	}
	if len(in.Material.SQLPaths) > 0 {
		ev.NeedsSQL = true
	}
	if !in.Material.HasCMake {
		ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
			"仓库根目录未见 CMakeLists.txt，可能不是标准 C++ 模块",
			"No CMakeLists.txt at repo root; may not be a standard C++ module"))
	}

	for _, iss := range in.Material.Issues {
		blob := strings.ToLower(iss.Title + " " + strings.Join(iss.Labels, " "))
		if iss.State == "open" && (strings.Contains(blob, "crash") || strings.Contains(blob, "compile") || strings.Contains(blob, "cmake") || strings.Contains(blob, "build")) {
			ev.IssueFindings = append(ev.IssueFindings, IssueFinding{
				Number: iss.Number, Severity: "high", Summary: iss.Title,
			})
			ev.Citations = append(ev.Citations, fmt.Sprintf("issues#%d", iss.Number))
		}
	}

	// Baseline heuristics first so UI is never empty.
	applyHeuristicBaseline(ev, in)

	modelOK := false
	if in.DS != nil && in.DS.Configured() {
		pack := buildRetrievalPack(in)
		system := evalSystemPrompt(in.Locale)
		userBytes, _ := json.Marshal(pack)
		raw, err := in.DS.ChatJSON(ctx, system, string(userBytes))
		if err != nil {
			ev.Degraded = true
			ev.DegradedReason = err.Error()
			ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
				"DeepSeek 调用失败，已使用规则评估："+shortErr(err),
				"DeepSeek call failed; using rule-based evaluation: "+shortErr(err)))
		} else if parsed, perr := parseModelEvaluation(raw); perr != nil {
			ev.Degraded = true
			ev.DegradedReason = "invalid model json: " + perr.Error()
			ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
				"AI 返回格式异常，已使用规则评估",
				"AI returned invalid JSON; using rule-based evaluation"))
		} else {
			mergeModelEval(ev, parsed)
			ev.ModelUsed = true
			modelOK = true
		}
	} else {
		ev.Degraded = true
		if ev.DegradedReason == "" {
			ev.DegradedReason = "deepseek_unconfigured"
		}
		ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
			"DeepSeek 未配置：仅展示规则评估结论",
			"DeepSeek is not configured; showing rule-based evaluation only"))
	}

	applyRuleOverlay(ev, in)
	finalizeScoreAndSummary(ev, in, modelOK)

	if in.CacheDir != "" && !ev.Degraded {
		_ = saveEvalCache(in.CacheDir, cacheKey, ev)
	}
	return ev, nil
}

func applyHeuristicBaseline(ev *Evaluation, in EvaluateInput) {
	ev.Steps = heuristicSteps(in)
	match, note := matchACoreVersion(in.Locale, in.Material.ACoreModuleJSON, in.Core.Revision, in.Core.Version)
	ev.ACVersionMatch = match
	ev.VersionNote = note
	ev.FeaturesZH = heuristicFeatures(in)

	score := 70
	hasACore := strings.TrimSpace(in.Material.ACoreModuleJSON) != ""
	readmeHasAC := strings.Contains(strings.ToLower(in.Material.Readme), "azerothcore")
	if hasACore || readmeHasAC {
		score += 10
	} else {
		score -= 25
	}
	if in.Material.HasCMake {
		score += 5
	}
	if len(in.Material.Issues) == 0 && hasACore {
		score += 5
	}
	if len(ev.IssueFindings) > 0 {
		score -= 15 * min(len(ev.IssueFindings), 3)
	}
	if match == "match" {
		score += 10
	} else if match == "mismatch" {
		score -= 30
	}
	owner := ""
	if parts := strings.Split(in.OwnerRepo, "/"); len(parts) > 0 {
		owner = parts[0]
	}
	if !OwnerAllowed(in.AllowOwners, owner) {
		score -= 10
		ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
			"仓库 owner 不在 allow_owners 白名单（可超管强装，但需更谨慎）",
			"Repo owner is not in allow_owners (superadmin can still force-install, but be careful)"))
	}
	// Local install state: informational. Compat score stays about module↔core/evidence.
	if in.InventoryOK {
		for _, m := range in.Installed {
			sameID := strings.EqualFold(m.ID, in.ModuleID)
			sameRepo := m.OwnerRepo != "" && strings.EqualFold(m.OwnerRepo, in.OwnerRepo)
			if sameID || sameRepo {
				ev.AlreadyInstalled = true
				ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
					"本机已安装 "+m.ID+"（commit "+m.Commit+"）：兼容分仍按模块与核心评估，重复安装会覆盖目录",
					"Already installed locally as "+m.ID+" (commit "+m.Commit+"): compat score still reflects module↔core; reinstall would overwrite the directory"))
			}
			if (strings.Contains(strings.ToLower(in.ModuleID), "eluna") || strings.Contains(strings.ToLower(in.OwnerRepo), "eluna")) &&
				strings.Contains(strings.ToLower(m.ID), "eluna") && !sameID {
				ev.Conflicts = appendUnique(ev.Conflicts, m.ID+": "+localeText(in.Locale, "可能与 Eluna 类模块重复", "possible duplicate with Eluna-class module"))
				score -= 8
			}
		}
	}
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	ev.CompatScore = score
	switch {
	case score >= 75 && len(ev.IssueFindings) == 0 && len(ev.Conflicts) == 0:
		ev.Verdict = "ok"
	case score < 40 || match == "mismatch":
		ev.Verdict = "no"
	default:
		ev.Verdict = "caution"
	}
	if ev.AlreadyInstalled && ev.Verdict == "ok" {
		ev.Verdict = "caution"
	}
}

func finalizeScoreAndSummary(ev *Evaluation, in EvaluateInput, modelOK bool) {
	if ev.CompatScore <= 0 {
		applyHeuristicBaseline(ev, in)
	}
	if len(ev.Steps) == 0 {
		ev.Steps = heuristicSteps(in)
	}
	if strings.TrimSpace(ev.FeaturesZH) == "" {
		ev.FeaturesZH = heuristicFeatures(in)
	}
	if strings.TrimSpace(ev.Summary) == "" {
		if isEvalEN(in.Locale) {
			parts := []string{
				fmt.Sprintf("Verdict %s, compat score %d/100.", ev.Verdict, ev.CompatScore),
			}
			if ev.CoreVersion != "" {
				parts = append(parts, "Local core: "+ev.CoreVersion+".")
			}
			if ev.VersionNote != "" {
				parts = append(parts, ev.VersionNote)
			} else if ev.ACVersionMatch == "unknown" {
				parts = append(parts, "Module does not declare a precise AC revision to compare.")
			}
			if len(ev.IssueFindings) > 0 {
				parts = append(parts, fmt.Sprintf("Found %d high-risk open issues (crash/build related).", len(ev.IssueFindings)))
			}
			if ev.NeedsSQL {
				parts = append(parts, "Install may apply SQL.")
			}
			parts = append(parts, "A worldserver rebuild/restart is required for the module to take effect.")
			if !modelOK {
				parts = append(parts, "(Rule-based evaluation"+ternary(ev.DegradedReason != "", ": "+shortReason(ev.DegradedReason), "")+")")
			}
			ev.Summary = strings.Join(parts, " ")
		} else {
			parts := []string{
				fmt.Sprintf("结论 %s，兼容分 %d/100。", ev.Verdict, ev.CompatScore),
			}
			if ev.CoreVersion != "" {
				parts = append(parts, "本机核心："+ev.CoreVersion+"。")
			}
			if ev.VersionNote != "" {
				parts = append(parts, ev.VersionNote)
			} else if ev.ACVersionMatch == "unknown" {
				parts = append(parts, "模块未声明可精确比对的 AC 版本，兼容性未知。")
			}
			if len(ev.IssueFindings) > 0 {
				parts = append(parts, fmt.Sprintf("发现 %d 条高风险开放 Issue（崩溃/编译相关）。", len(ev.IssueFindings)))
			}
			if ev.NeedsSQL {
				parts = append(parts, "安装后可能写入 SQL。")
			}
			parts = append(parts, "必须重建并重启 worldserver 后才会生效。")
			if !modelOK {
				parts = append(parts, "（当前为规则评估"+ternary(ev.DegradedReason != "", "："+shortReason(ev.DegradedReason), "")+"）")
			}
			ev.Summary = strings.Join(parts, " ")
		}
	}
}

func heuristicFeatures(in EvaluateInput) string {
	en := isEvalEN(in.Locale)
	if en {
		if s := strings.TrimSpace(in.CuratedSummaryEN); s != "" {
			return s
		}
		if s := strings.TrimSpace(in.CuratedSummaryZH); s != "" {
			return s
		}
	} else {
		if s := strings.TrimSpace(in.CuratedSummaryZH); s != "" {
			return s
		}
		if s := strings.TrimSpace(in.CuratedSummaryEN); s != "" {
			return s
		}
	}
	if in.Material == nil {
		return ""
	}
	readme := strings.TrimSpace(in.Material.Readme)
	if readme == "" {
		return localeText(in.Locale, "暂无功能说明（README 缺失）。", "No feature summary available (README missing).")
	}
	lines := []string{}
	for _, line := range strings.Split(readme, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "![") || strings.HasPrefix(line, "<") {
			continue
		}
		line = strings.TrimLeft(line, "*-• ")
		if len(line) < 8 {
			continue
		}
		lines = append(lines, line)
		if len(lines) >= 3 {
			break
		}
	}
	if len(lines) == 0 {
		return localeText(in.Locale, "请参阅仓库 README 了解功能。", "See the repository README for features.")
	}
	return strings.Join(lines, " ")
}

func mergeModelEval(dst, src *Evaluation) {
	if src.Verdict != "" {
		dst.Verdict = src.Verdict
	}
	if src.CompatScore > 0 {
		dst.CompatScore = src.CompatScore
	}
	// Prefer rule-derived match later; only take model match/mismatch when meaningful.
	if src.ACVersionMatch == "match" || src.ACVersionMatch == "mismatch" {
		dst.ACVersionMatch = src.ACVersionMatch
	}
	if strings.TrimSpace(src.VersionNote) != "" {
		dst.VersionNote = src.VersionNote
	}
	if strings.TrimSpace(src.FeaturesZH) != "" {
		dst.FeaturesZH = src.FeaturesZH
	}
	if strings.TrimSpace(src.Summary) != "" {
		dst.Summary = src.Summary
	}
	dst.NeedsRebuild = src.NeedsRebuild || dst.NeedsRebuild
	dst.NeedsSQL = src.NeedsSQL || dst.NeedsSQL
	dst.NeedsClientPatch = src.NeedsClientPatch || dst.NeedsClientPatch
	dst.AlreadyInstalled = dst.AlreadyInstalled || src.AlreadyInstalled
	if len(src.Conflicts) > 0 {
		dst.Conflicts = src.Conflicts
	}
	if len(src.IssueFindings) > 0 {
		dst.IssueFindings = src.IssueFindings
	}
	if len(src.Risks) > 0 {
		for _, r := range src.Risks {
			dst.Risks = appendUnique(dst.Risks, r)
		}
	}
	if len(src.Steps) > 0 {
		dst.Steps = src.Steps
	}
	if len(src.MissingEvidence) > 0 {
		for _, m := range src.MissingEvidence {
			dst.MissingEvidence = appendUnique(dst.MissingEvidence, m)
		}
	}
	if len(src.Citations) > 0 {
		for _, c := range src.Citations {
			dst.Citations = appendUnique(dst.Citations, c)
		}
	}
}

func parseModelEvaluation(raw json.RawMessage) (*Evaluation, error) {
	var loose map[string]any
	if err := json.Unmarshal(raw, &loose); err != nil {
		return nil, err
	}
	ev := &Evaluation{}
	ev.Verdict = strings.ToLower(strings.TrimSpace(asString(loose["verdict"])))
	ev.CompatScore = asInt(loose["compat_score"])
	ev.ACVersionMatch = strings.ToLower(strings.TrimSpace(asString(loose["ac_version_match"])))
	ev.FeaturesZH = firstNonEmpty(
		asString(loose["features_zh"]),
		asString(loose["features_en"]),
		asString(loose["feature_summary"]),
		asString(loose["features"]),
		asString(loose["description_zh"]),
		asString(loose["description_en"]),
		asString(loose["description"]),
	)
	ev.Summary = firstNonEmpty(asString(loose["summary"]), asString(loose["advice"]), asString(loose["recommendation"]))
	ev.VersionNote = firstNonEmpty(
		asString(loose["version_note"]),
		asString(loose["version_note_zh"]),
		asString(loose["version_note_en"]),
	)
	ev.NeedsRebuild = asBool(loose["needs_rebuild"], true)
	ev.NeedsSQL = asBool(loose["needs_sql"], false)
	ev.NeedsClientPatch = asBool(loose["needs_client_patch"], false)
	ev.AlreadyInstalled = asBool(loose["already_installed"], false)
	ev.Conflicts = asStringList(loose["conflicts"])
	ev.Risks = asStringList(loose["risks"])
	ev.MissingEvidence = asStringList(loose["missing_evidence"])
	ev.Citations = asStringList(loose["citations"])
	ev.IssueFindings = asIssueFindings(loose["issue_findings"])
	ev.Steps = asSteps(loose["steps"])
	if ev.Verdict != "ok" && ev.Verdict != "caution" && ev.Verdict != "no" {
		ev.Verdict = "caution"
	}
	return ev, nil
}

func asString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return fmt.Sprintf("%.0f", t)
	case json.Number:
		return t.String()
	default:
		return ""
	}
}

func asInt(v any) int {
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case json.Number:
		i, _ := t.Int64()
		return int(i)
	case string:
		var n int
		fmt.Sscanf(strings.TrimSpace(t), "%d", &n)
		return n
	default:
		return 0
	}
}

func asBool(v any, def bool) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		switch strings.ToLower(t) {
		case "true", "1", "yes":
			return true
		case "false", "0", "no":
			return false
		}
	case float64:
		return t != 0
	}
	return def
}

func asStringList(v any) []string {
	out := []string{}
	switch t := v.(type) {
	case []any:
		for _, x := range t {
			s := strings.TrimSpace(asString(x))
			if s != "" {
				out = append(out, s)
			}
		}
	case string:
		if s := strings.TrimSpace(t); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func asIssueFindings(v any) []IssueFinding {
	out := []IssueFinding{}
	arr, ok := v.([]any)
	if !ok {
		return out
	}
	for _, item := range arr {
		switch t := item.(type) {
		case map[string]any:
			f := IssueFinding{
				Number:   asInt(t["number"]),
				Severity: firstNonEmpty(asString(t["severity"]), "medium"),
				Summary:  firstNonEmpty(asString(t["summary"]), asString(t["title"])),
			}
			if f.Number > 0 || f.Summary != "" {
				out = append(out, f)
			}
		case string:
			out = append(out, IssueFinding{Severity: "medium", Summary: t})
		}
	}
	return out
}

func asSteps(v any) []EvalStep {
	out := []EvalStep{}
	arr, ok := v.([]any)
	if !ok {
		return out
	}
	for _, item := range arr {
		switch t := item.(type) {
		case map[string]any:
			s := EvalStep{
				Title:   firstNonEmpty(asString(t["title"]), asString(t["name"]), asString(t["step"])),
				Command: asString(t["command"]),
				Source:  firstNonEmpty(asString(t["source"]), "model"),
				Phase:   asString(t["phase"]),
			}
			if s.Title != "" || s.Command != "" {
				out = append(out, s)
			}
		case string:
			out = append(out, EvalStep{Title: t, Source: "model"})
		}
	}
	return out
}

func applyRuleOverlay(ev *Evaluation, in EvaluateInput) {
	capVerdict := func(max string) {
		order := map[string]int{"ok": 0, "caution": 1, "no": 2}
		if order[ev.Verdict] < order[max] {
			ev.Verdict = max
		}
	}
	hasACore := strings.TrimSpace(in.Material.ACoreModuleJSON) != ""
	readmeHasAC := strings.Contains(strings.ToLower(in.Material.Readme), "azerothcore")
	if !hasACore && !readmeHasAC {
		capVerdict("caution")
		ev.MissingEvidence = appendUnique(ev.MissingEvidence, "azerothcore mention")
	}
	if match, note := matchACoreVersion(in.Locale, in.Material.ACoreModuleJSON, in.Core.Revision, in.Core.Version); match == "mismatch" {
		ev.ACVersionMatch = "mismatch"
		ev.VersionNote = note
		capVerdict("no")
		ev.Risks = appendUnique(ev.Risks, localeText(in.Locale,
			"acore-module.json 与本机核心版本不匹配",
			"acore-module.json does not match the local core revision"))
	} else if match == "match" {
		ev.ACVersionMatch = "match"
		ev.VersionNote = note
	} else {
		// Keep unknown, but prefer factual local-core note over model hallucinations.
		if ev.ACVersionMatch != "match" && ev.ACVersionMatch != "mismatch" {
			ev.ACVersionMatch = "unknown"
		}
		if note != "" {
			ev.VersionNote = note
		}
	}

	owner := strings.Split(in.OwnerRepo, "/")[0]
	if !OwnerAllowed(in.AllowOwners, owner) {
		capVerdict("caution")
	}

	if len(ev.IssueFindings) > 0 {
		capVerdict("caution")
	}
	for _, m := range ev.MissingEvidence {
		if m == "README" && ev.Verdict == "ok" {
			ev.Verdict = "caution"
		}
	}
	if ev.Verdict == "" {
		ev.Verdict = "caution"
	}
	if in.InventoryOK {
		for _, m := range in.Installed {
			if strings.EqualFold(m.ID, in.ModuleID) || (m.OwnerRepo != "" && strings.EqualFold(m.OwnerRepo, in.OwnerRepo)) {
				ev.AlreadyInstalled = true
				break
			}
		}
	} else {
		// Model may invent conflicts when inventory is empty — drop them.
		ev.Conflicts = []string{}
	}
	if ev.AlreadyInstalled && ev.Verdict == "ok" {
		ev.Verdict = "caution"
	}
}

func matchACoreVersion(locale, acJSON, revision, version string) (string, string) {
	local := strings.TrimSpace(revision)
	if local == "" {
		local = ShortRevision(version)
	}
	localLabel := firstNonEmpty(strings.TrimSpace(version), local)
	en := isEvalEN(locale)

	if strings.TrimSpace(acJSON) == "" {
		if local != "" {
			return "unknown", localeText(locale,
				"本机核心："+localLabel+"。模块未提供 acore-module.json，无法精确比对兼容 revision。",
				"Local core: "+localLabel+". Module has no acore-module.json; cannot verify revision compatibility precisely.")
		}
		return "unknown", localeText(locale,
			"模块未提供 acore-module.json，且本机核心版本未知。",
			"Module has no acore-module.json, and local core version is unknown.")
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(acJSON), &obj); err != nil {
		if local != "" {
			return "unknown", localeText(locale,
				"本机核心："+localLabel+"。acore-module.json 无法解析。",
				"Local core: "+localLabel+". acore-module.json could not be parsed.")
		}
		return "unknown", localeText(locale, "acore-module.json 无法解析。", "acore-module.json could not be parsed.")
	}
	declared := []string{}
	collectVersions(obj, &declared)
	noteParts := []string{}
	if localLabel != "" {
		noteParts = append(noteParts, localeText(locale, "本机："+localLabel, "Local: "+localLabel))
	}
	if len(declared) > 0 {
		uniq := uniqueStrings(declared)
		if len(uniq) > 6 {
			uniq = uniq[:6]
		}
		noteParts = append(noteParts, localeText(locale,
			"模块声明/提及："+strings.Join(uniq, ", "),
			"Module declares/mentions: "+strings.Join(uniq, ", ")))
	}
	note := strings.Join(noteParts, ternary(en, ". ", "。"))

	blob, _ := json.Marshal(obj)
	low := strings.ToLower(string(blob))
	rev := strings.ToLower(local)
	if rev != "" && len(rev) >= 7 && strings.Contains(low, rev[:7]) {
		return "match", note + localeText(locale, "。命中本机 revision。", ". Matches local revision.")
	}
	if rev == "" {
		return "unknown", note + localeText(locale, "。本机核心 revision 未知，无法比对。", ". Local core revision unknown; cannot compare.")
	}
	if strings.Contains(low, "azerothcore") || strings.Contains(low, "compatibility") || strings.Contains(low, "tested") {
		return "unknown", note + localeText(locale,
			"。未找到与本机 revision 的精确匹配（不等于核心未配置）。",
			". No exact match for the local revision (this does not mean the core is unconfigured).")
	}
	return "unknown", note + localeText(locale,
		"。兼容字段不完整，无法确认是否匹配本机 "+rev+"。",
		". Compatibility fields incomplete; cannot confirm match with local "+rev+".")
}

func collectVersions(v any, out *[]string) {
	switch t := v.(type) {
	case map[string]any:
		for k, child := range t {
			lk := strings.ToLower(k)
			if strings.Contains(lk, "version") || strings.Contains(lk, "compat") || strings.Contains(lk, "tested") || strings.Contains(lk, "azeroth") {
				if s, ok := child.(string); ok && strings.TrimSpace(s) != "" {
					*out = append(*out, strings.TrimSpace(s))
				}
			}
			collectVersions(child, out)
		}
	case []any:
		for _, child := range t {
			if s, ok := child.(string); ok && strings.TrimSpace(s) != "" && len(s) < 80 {
				*out = append(*out, strings.TrimSpace(s))
			} else {
				collectVersions(child, out)
			}
		}
	}
}

func buildRetrievalPack(in EvaluateInput) map[string]any {
	installed := []map[string]any{}
	if in.InventoryOK {
		for _, m := range in.Installed {
			installed = append(installed, map[string]any{
				"id": m.ID, "commit": m.Commit, "branch": m.Branch, "owner_repo": m.OwnerRepo,
			})
		}
	}
	issues := []map[string]any{}
	for _, iss := range in.Material.Issues {
		if len(issues) >= 25 {
			break
		}
		issues = append(issues, map[string]any{
			"number": iss.Number, "title": iss.Title, "state": iss.State,
			"labels": iss.Labels, "comments": iss.Comments, "body_excerpt": iss.Excerpt,
			"html_url": iss.URL, "weight": iss.Weight,
		})
	}
	coreNote := ""
	if strings.TrimSpace(in.Core.Revision) == "" && strings.TrimSpace(in.Core.Version) == "" {
		coreNote = localeText(in.Locale,
			"本机核心版本未能自动探测（非用户未提供）；ac_version_match 请标 unknown，并在 version_note 说明需先确认 SOAP/AC_ROOT",
			"Local core version could not be auto-detected (not that the user omitted it); set ac_version_match to unknown and explain SOAP/AC_ROOT in version_note")
	}
	invNote := ""
	if !in.InventoryOK {
		invNote = localeText(in.Locale,
			"本机 modules 目录不可读：installed 为空不代表未安装任何模块。compat_score 只评模块与核心/仓库证据，不要因「已装列表为空」加分或假设无冲突。",
			"Local modules/ is unreadable: empty installed does NOT mean nothing is installed. Score module↔core/repo evidence only; do not boost score or assume no conflicts because installed is empty.")
	}
	rules := []string{
		localeText(in.Locale, "只根据本 JSON 作答，不要用训练记忆补安装命令", "Answer only from this JSON; do not invent install commands from training memory"),
		localeText(in.Locale,
			"compat_score(0-100)只表示模块与本机核心/仓库证据的兼容性，不要因「已安装」大幅扣分或因「未探测到已装」加分",
			"compat_score(0-100) measures module↔core/repo evidence only; do not slash score just because already installed, nor inflate it when inventory is missing"),
		localeText(in.Locale,
			"必须给出 features_zh（2-4句中文功能说明）、summary（2-4句中文建议）、compat_score、verdict(ok|caution|no)；若已安装可设 already_installed=true",
			"Must provide features_en, summary, compat_score, verdict(ok|caution|no); set already_installed=true if the pack shows it is installed"),
		localeText(in.Locale,
			"ac_version_match 为 match|unknown|mismatch，并写 version_note",
			"ac_version_match must be match|unknown|mismatch with version_note"),
		localeText(in.Locale,
			"仅当 inventory_ok=true 且 installed 里有明确冲突时才写 conflicts",
			"Only fill conflicts when inventory_ok=true and installed lists a clear conflict"),
		"Output must be JSON only",
	}
	return map[string]any{
		"locale": in.Locale,
		"core": map[string]any{
			"version": in.Core.Version, "revision": in.Core.Revision, "deploy": in.Core.Deploy,
			"note":    coreNote,
		},
		"inventory_ok":     in.InventoryOK,
		"inventory_note":   invNote,
		"installed":        installed,
		"target_module": map[string]any{
			"repo": in.OwnerRepo, "url": "https://github.com/" + in.OwnerRepo, "ref": in.Ref,
			"curated_summary_zh": in.CuratedSummaryZH,
			"curated_summary_en": in.CuratedSummaryEN,
			"acore_module_json":  jsonRawOrEmpty(in.Material.ACoreModuleJSON),
			"readme":             truncate(in.Material.Readme, 20*1024),
			"has_cmake":          in.Material.HasCMake,
			"sql_paths":          in.Material.SQLPaths,
			"conf_dist":          in.Material.ConfDist,
			"issues":             issues,
			"topics":             in.Material.Topics,
		},
		"rules": rules,
	}
}

func evalSystemPrompt(locale string) string {
	if isEvalEN(locale) {
		return `You are an AzerothCore module compatibility advisor. Write ALL human-readable strings in English.
Judge ONLY from the retrieval pack.
compat_score = how well the module fits the local core + repo evidence (README, acore-module.json, issues). It is NOT a "should reinstall" score.
If inventory_ok is false, ignore empty installed lists and do not invent installed modules.
If the module is already installed, set already_installed=true and mention it in summary/risks, but do not crush compat_score for that alone.
Return JSON with at least:
features_en, summary, verdict (ok|caution|no), compat_score (0-100),
ac_version_match (match|unknown|mismatch), version_note,
already_installed, needs_rebuild, needs_sql, needs_client_patch,
conflicts, issue_findings, risks, steps, missing_evidence, citations.
Always fill features_en (or features), summary, and compat_score.`
	}
	return `你是 AzerothCore 模块兼容性顾问。所有说明文字使用简体中文。
只根据检索包判断。
compat_score = 模块与本机核心 + 仓库证据（README / acore-module.json / Issues）的契合度，不是「要不要重装」的分。
若 inventory_ok=false，不得把空的 installed 当成「什么都没装」，也不要臆造已装模块。
若模块已安装：already_installed=true，在 summary/risks 提示即可，不要仅因此大幅扣 compat_score。
必须输出 JSON，字段至少包含:
features_zh, summary, verdict(ok|caution|no), compat_score(0-100),
ac_version_match(match|unknown|mismatch), version_note,
already_installed, needs_rebuild, needs_sql, needs_client_patch,
conflicts, issue_findings, risks, steps, missing_evidence, citations。
务必填写 features_zh、summary 与 compat_score。`
}

func heuristicSteps(in EvaluateInput) []EvalStep {
	id := in.ModuleID
	url := "https://github.com/" + in.OwnerRepo + ".git"
	if isEvalEN(in.Locale) {
		steps := []EvalStep{
			{Title: "Create checkpoint (image + DBs + module list)", Phase: "checkpoint", Source: "panel"},
			{Title: "Clone into modules/", Command: fmt.Sprintf("git clone %s modules/%s", url, id), Phase: "clone", Source: "heuristic"},
		}
		if in.Core.Deploy == "docker" {
			steps = append(steps, EvalStep{Title: "Rebuild world image", Command: "docker compose up -d --build", Phase: "build", Source: "heuristic"})
		} else {
			steps = append(steps, EvalStep{Title: "Rebuild core", Command: "./acore.sh compiler build", Phase: "build", Source: "heuristic"})
		}
		if in.Material != nil && len(in.Material.ConfDist) > 0 {
			steps = append(steps, EvalStep{Title: "Copy conf.dist into etc/modules (do not overwrite existing)", Phase: "conf", Source: "heuristic"})
		}
		if in.Material != nil && len(in.Material.SQLPaths) > 0 {
			steps = append(steps, EvalStep{Title: "Confirm module SQL auto-imports on startup (or follow README into data/sql/custom)", Phase: "sql", Source: "heuristic"})
		}
		steps = append(steps, EvalStep{Title: "Restart and verify with .server debug", Phase: "verify", Source: "heuristic"})
		return steps
	}
	steps := []EvalStep{
		{Title: "打检查点（镜像+四库+清单）", Phase: "checkpoint", Source: "panel"},
		{Title: "clone 到 modules/", Command: fmt.Sprintf("git clone %s modules/%s", url, id), Phase: "clone", Source: "heuristic"},
	}
	if in.Core.Deploy == "docker" {
		steps = append(steps, EvalStep{Title: "重建 world 镜像", Command: "docker compose up -d --build", Phase: "build", Source: "heuristic"})
	} else {
		steps = append(steps, EvalStep{Title: "重新编译核心", Command: "./acore.sh compiler build", Phase: "build", Source: "heuristic"})
	}
	if in.Material != nil && len(in.Material.ConfDist) > 0 {
		steps = append(steps, EvalStep{Title: "复制 conf.dist 到 etc/modules（已存在勿覆盖）", Phase: "conf", Source: "heuristic"})
	}
	if in.Material != nil && len(in.Material.SQLPaths) > 0 {
		steps = append(steps, EvalStep{Title: "确认模块 SQL 会在启动时自动导入（或按 README 拷到 data/sql/custom）", Phase: "sql", Source: "heuristic"})
	}
	steps = append(steps, EvalStep{Title: "重启后用 .server debug 确认模块已加载", Phase: "verify", Source: "heuristic"})
	return steps
}

func evalCacheKey(in EvaluateInput) string {
	h := sha256.New()
	commit := ""
	if in.Material != nil {
		commit = in.Material.LatestCommit
	}
	locale := "zh"
	if isEvalEN(in.Locale) {
		locale = "en"
	}
	invFlag := "0"
	if in.InventoryOK {
		invFlag = "1"
	}
	fmt.Fprintf(h, "%s|%s|%s|%s|%s|inv%s|v6|", in.OwnerRepo, in.Ref, in.Core.Revision, commit, locale, invFlag)
	for _, m := range in.Installed {
		fmt.Fprintf(h, "%s@%s;", m.ID, m.Commit)
	}
	if in.Material != nil {
		fmt.Fprintf(h, "issues:%d", len(in.Material.Issues))
	}
	return hex.EncodeToString(h.Sum(nil))[:24]
}

func loadEvalCache(dir, key string) (*Evaluation, bool) {
	raw, err := os.ReadFile(filepath.Join(dir, "eval-"+key+".json"))
	if err != nil {
		return nil, false
	}
	var ev Evaluation
	if err := json.Unmarshal(raw, &ev); err != nil {
		return nil, false
	}
	if time.Since(ev.EvaluatedAt) > 24*time.Hour {
		return nil, false
	}
	if ev.CompatScore <= 0 || strings.TrimSpace(ev.Summary) == "" {
		return nil, false
	}
	return &ev, true
}

func saveEvalCache(dir, key string, ev *Evaluation) error {
	_ = os.MkdirAll(dir, 0o755)
	raw, err := json.MarshalIndent(ev, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "eval-"+key+".json"), raw, 0o644)
}

func orEmptyJSON(s string) string {
	if strings.TrimSpace(s) == "" {
		return "{}"
	}
	if json.Valid([]byte(s)) {
		return s
	}
	b, _ := json.Marshal(s)
	return string(b)
}

func jsonRawOrEmpty(s string) any {
	s = orEmptyJSON(s)
	return json.RawMessage(s)
}

func appendUnique(list []string, v string) []string {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

func shortErr(err error) string {
	if err == nil {
		return ""
	}
	return truncate(err.Error(), 120)
}

func shortReason(s string) string {
	return truncate(s, 120)
}

func ternary(cond bool, a, b string) string {
	if cond {
		return a
	}
	return b
}

func isEvalEN(locale string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(locale)), "en")
}

func localeText(locale, zh, en string) string {
	if isEvalEN(locale) {
		return en
	}
	return zh
}
