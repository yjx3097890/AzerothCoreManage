package httpapi

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"acmanage/internal/app"
	"acmanage/internal/audit"
	"acmanage/internal/deepseek"
	"acmanage/internal/modules"

	"github.com/gin-gonic/gin"
)

func (s *Server) listModulesCatalog(c *gin.Context) {
	if _, err := s.app.Target(TargetID(c)); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	q := c.Query("q")
	curatedPath := s.app.Cfg.Modules.CuratedPath
	if curatedPath == "" {
		curatedPath = filepath.Join("data", "modules", "curated.json")
	}
	curated, _ := modules.LoadCurated(curatedPath)
	catalogue, catErr, _ := modules.FetchCatalogue(nil, c.Query("refresh") == "1")
	items := modules.MergeCatalog(curated, catalogue, q)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 12*time.Second)
	defer cancel()
	gh := modules.NewGitHubClient(s.app.Cfg.GitHub.Token)
	// Only enrich curated rows (and any missing pushed_at among the first page of results
	// would be heavy); EnrichCatalogMeta already prefers curated / missing dates.
	items = modules.EnrichCatalogMeta(ctx, gh, items)
	out := gin.H{"items": items}
	if catErr != "" {
		out["catalogue_warning"] = catErr
	}
	JSON(c, out)
}

func (s *Server) listModulesInstalled(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	inv := s.buildInventory(c, rt)
	JSON(c, inv)
}

func (s *Server) buildInventory(c *gin.Context, rt *app.TargetRuntime) modules.Inventory {
	paths := modules.ResolvePaths(rt.Cfg)
	core := modules.CoreInfo{Deploy: paths.Deploy}
	var loaded map[string]string
	if rt.SOAP != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
		defer cancel()
		if raw, err := rt.SOAP.Execute(ctx, "server info"); err == nil {
			p := parseServerInfo(raw)
			core.Version = p.Version
			core.Revision = modules.ShortRevision(p.Version)
			if core.Version != "" {
				core.Source = "soap"
			}
		}
		if raw, err := rt.SOAP.Execute(ctx, "server debug"); err == nil {
			loaded = modules.ParseServerDebug(raw)
		}
	}
	modules.FillCoreFromGit(c.Request.Context(), &core, paths)
	modules.ApplyConfiguredCore(&core, rt.Cfg.Modules.CoreVersion, rt.Cfg.Modules.CoreRevision)
	return modules.CollectInventory(c.Request.Context(), rt.Cfg.ID, paths, core, loaded)
}

func (s *Server) listModulesRegistry(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	items, err := modules.LoadRegistry(s.app.Cfg.Modules.RegistryPath, rt.Cfg.ID)
	if err != nil {
		Fail(c, http.StatusBadGateway, "modules_path_unavailable", err.Error())
		return
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) postModulesRegistry(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	paths := modules.ResolvePaths(rt.Cfg)
	var req struct {
		URL     string `json:"url"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	ownerRepo, ref, url, err := modules.ParseGitHubSpec(req.URL, paths.AllowedHosts)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	id := modules.ModuleIDFromOwnerRepo(ownerRepo)
	entry := modules.RegistryEntry{
		ID:        id,
		OwnerRepo: ownerRepo,
		URL:       url,
		Ref:       ref,
		TargetID:  rt.Cfg.ID,
		AddedAt:   time.Now().UTC(),
		AddedBy:   Username(c),
	}
	gh := modules.NewGitHubClient(s.app.Cfg.GitHub.Token)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	mat, _ := gh.FetchRepoMaterial(ctx, ownerRepo, ref, nil, "")
	if mat != nil {
		entry.Topics = mat.Topics
		has := strings.TrimSpace(mat.ACoreModuleJSON) != ""
		entry.HasACore = &has
	}
	if err := modules.AddRegistry(s.app.Cfg.Modules.RegistryPath, entry); err != nil {
		Fail(c, http.StatusBadGateway, "modules_path_unavailable", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.registry.add", Detail: ownerRepo, OK: true,
	})
	JSON(c, entry)
}

func (s *Server) deleteModulesRegistry(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	if !modules.IsSafeModuleID(id) {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var req struct {
		Confirm bool `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&req)
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	if err := modules.RemoveRegistry(s.app.Cfg.Modules.RegistryPath, rt.Cfg.ID, id); err != nil {
		Fail(c, http.StatusNotFound, "not_found", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.registry.remove", Detail: id, OK: true,
	})
	JSON(c, gin.H{"deleted": id})
}

func (s *Server) getModule(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	if !modules.IsSafeModuleID(id) {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	paths := modules.ResolvePaths(rt.Cfg)
	inv := s.buildInventory(c, rt)
	var installed *modules.InstalledModule
	for i := range inv.Items {
		if strings.EqualFold(inv.Items[i].ID, id) {
			installed = &inv.Items[i]
			break
		}
	}
	reg, _ := modules.LoadRegistry(s.app.Cfg.Modules.RegistryPath, rt.Cfg.ID)
	var registry *modules.RegistryEntry
	for i := range reg {
		if strings.EqualFold(reg[i].ID, id) {
			registry = &reg[i]
			break
		}
	}
	JSON(c, gin.H{
		"id":        id,
		"installed": installed,
		"registry":  registry,
		"core":      inv.Core,
		"paths":     paths,
	})
}

func (s *Server) resolveModuleOwnerRepo(c *gin.Context, id string) (ownerRepo, ref string, errMsg string) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		return "", "", "bad_target"
	}
	paths := modules.ResolvePaths(rt.Cfg)
	core := modules.CoreInfo{Deploy: paths.Deploy}
	inv := modules.CollectInventory(c.Request.Context(), rt.Cfg.ID, paths, core, nil)
	for _, m := range inv.Items {
		if strings.EqualFold(m.ID, id) && m.OwnerRepo != "" {
			return m.OwnerRepo, m.Branch, ""
		}
	}
	reg, _ := modules.LoadRegistry(s.app.Cfg.Modules.RegistryPath, rt.Cfg.ID)
	for _, r := range reg {
		if strings.EqualFold(r.ID, id) {
			return r.OwnerRepo, r.Ref, ""
		}
	}
	curated, _ := modules.LoadCurated(s.app.Cfg.Modules.CuratedPath)
	for _, cu := range curated {
		if strings.EqualFold(cu.ID, id) {
			return cu.OwnerRepo, "", ""
		}
	}
	catalogue, _, _ := modules.FetchCatalogue(nil, false)
	for _, e := range catalogue {
		if strings.EqualFold(e.ID, id) || strings.EqualFold(filepath.Base(e.FullName), id) {
			return e.FullName, "", ""
		}
	}
	if strings.Count(id, "/") == 1 {
		return id, "", ""
	}
	return "", "", "not_found"
}

func (s *Server) postModuleEvaluate(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	force := false
	var req struct {
		Force bool   `json:"force"`
		URL   string `json:"url"`
	}
	_ = c.ShouldBindJSON(&req)
	force = req.Force || c.Query("force") == "1"
	if req.URL != "" {
		paths := modules.ResolvePaths(rt.Cfg)
		or, ref, _, err := modules.ParseGitHubSpec(req.URL, paths.AllowedHosts)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		s.doEvaluate(c, rt, modules.ModuleIDFromOwnerRepo(or), or, ref, force)
		return
	}
	if !modules.IsSafeModuleID(id) && strings.Count(id, "/") != 1 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	ownerRepo, ref, errMsg := s.resolveModuleOwnerRepo(c, id)
	if errMsg == "not_found" {
		FailCode(c, http.StatusNotFound, "not_found")
		return
	}
	if errMsg != "" {
		FailCode(c, http.StatusBadRequest, errMsg)
		return
	}
	s.doEvaluate(c, rt, id, ownerRepo, ref, force)
}

func (s *Server) getModuleEvaluate(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	ownerRepo, ref, errMsg := s.resolveModuleOwnerRepo(c, id)
	if errMsg == "not_found" {
		FailCode(c, http.StatusNotFound, "not_found")
		return
	}
	if errMsg != "" {
		FailCode(c, http.StatusBadRequest, errMsg)
		return
	}
	force := c.Query("force") == "1" || c.Query("refresh") == "1"
	s.doEvaluate(c, rt, id, ownerRepo, ref, force)
}

func (s *Server) doEvaluate(c *gin.Context, rt *app.TargetRuntime, moduleID, ownerRepo, ref string, force bool) {
	paths := modules.ResolvePaths(rt.Cfg)
	core := modules.CoreInfo{Deploy: paths.Deploy}
	var loaded map[string]string
	ctx, cancel := context.WithTimeout(c.Request.Context(), 90*time.Second)
	defer cancel()
	if rt.SOAP != nil {
		if raw, err := rt.SOAP.Execute(ctx, "server info"); err == nil {
			p := parseServerInfo(raw)
			core.Version = p.Version
			core.Revision = modules.ShortRevision(p.Version)
			if core.Version != "" {
				core.Source = "soap"
			}
		}
		if raw, err := rt.SOAP.Execute(ctx, "server debug"); err == nil {
			loaded = modules.ParseServerDebug(raw)
		}
	}
	modules.FillCoreFromGit(ctx, &core, paths)
	modules.ApplyConfiguredCore(&core, rt.Cfg.Modules.CoreVersion, rt.Cfg.Modules.CoreRevision)
	inv := modules.CollectInventory(ctx, rt.Cfg.ID, paths, core, loaded)
	gh := modules.NewGitHubClient(s.app.Cfg.GitHub.Token)
	installedIDs := make([]string, 0, len(inv.Items))
	for _, m := range inv.Items {
		installedIDs = append(installedIDs, m.ID)
	}
	mat, fetchErr := gh.FetchRepoMaterial(ctx, ownerRepo, ref, installedIDs, core.Revision)
	if mat == nil {
		mat = &modules.RepoMaterial{OwnerRepo: ownerRepo}
	}
	ds := deepseek.New(s.app.Cfg.DeepSeek.APIKey, s.app.Cfg.DeepSeek.BaseURL, s.app.Cfg.DeepSeek.Model)
	locale := c.GetHeader("X-Locale")
	if locale == "" {
		locale = "zh-CN"
	}
	var curatedZH, curatedEN string
	curatedPath := s.app.Cfg.Modules.CuratedPath
	if curatedPath == "" {
		curatedPath = filepath.Join("data", "modules", "curated.json")
	}
	if curated, err := modules.LoadCurated(curatedPath); err == nil {
		for _, cu := range curated {
			if strings.EqualFold(cu.ID, moduleID) || strings.EqualFold(cu.OwnerRepo, ownerRepo) {
				curatedZH, curatedEN = cu.SummaryZH, cu.SummaryEN
				break
			}
		}
	}
	ev, err := modules.Evaluate(ctx, modules.EvaluateInput{
		Locale:           locale,
		ModuleID:         moduleID,
		OwnerRepo:        ownerRepo,
		Ref:              ref,
		AllowOwners:      paths.AllowOwners,
		Core:             inv.Core,
		Installed:        inv.Items,
		Material:         mat,
		CuratedSummaryZH: curatedZH,
		CuratedSummaryEN: curatedEN,
		DS:               ds,
		CacheDir:         s.app.Cfg.Modules.CacheDir,
		Force:            force,
	})
	if err != nil {
		Fail(c, http.StatusBadGateway, "evaluate_degraded", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.evaluate", Detail: ownerRepo + ":" + ev.Verdict, OK: true,
	})
	out := gin.H{
		"evaluation": ev,
		"material": gin.H{
			"owner_repo":         mat.OwnerRepo,
			"default_branch":     mat.DefaultBranch,
			"latest_commit":      mat.LatestCommit,
			"latest_commit_date": mat.LatestCommitDate,
			"has_cmake":          mat.HasCMake,
			"sql_paths":          mat.SQLPaths,
			"conf_dist":          mat.ConfDist,
			"topics":             mat.Topics,
			"fetch_errors":       mat.FetchErrors,
			"rate_limited":       mat.RateLimited,
			"has_readme":         strings.TrimSpace(mat.Readme) != "",
			"has_acore_json":     strings.TrimSpace(mat.ACoreModuleJSON) != "",
		},
		"deepseek_configured": ds.Configured(),
	}
	if fetchErr != nil {
		out["fetch_warning"] = fetchErr.Error()
	}
	JSON(c, out)
}

func (s *Server) listModuleIssues(c *gin.Context) {
	id := c.Param("id")
	ownerRepo, _, errMsg := s.resolveModuleOwnerRepo(c, id)
	if errMsg == "not_found" {
		FailCode(c, http.StatusNotFound, "not_found")
		return
	}
	if errMsg != "" {
		FailCode(c, http.StatusBadRequest, errMsg)
		return
	}
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	inv := s.buildInventory(c, rt)
	ids := make([]string, 0, len(inv.Items))
	for _, m := range inv.Items {
		ids = append(ids, m.ID)
	}
	gh := modules.NewGitHubClient(s.app.Cfg.GitHub.Token)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	issues, rateLimited, err := gh.FetchIssuesOnly(ctx, ownerRepo, ids, inv.Core.Revision)
	if err != nil && len(issues) == 0 {
		code := "evaluate_degraded"
		if rateLimited {
			code = "github_rate_limited"
		}
		Fail(c, http.StatusBadGateway, code, err.Error())
		return
	}
	JSON(c, gin.H{"items": issues, "rate_limited": rateLimited, "owner_repo": ownerRepo})
}

func (s *Server) getModuleConf(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	paths := modules.ResolvePaths(rt.Cfg)
	id := c.Param("id")
	conf, ok := modules.FindConfForModule(paths.EtcModulesDir, id)
	if !ok {
		path, err := modules.ResolveModuleConf(paths.EtcModulesDir, id)
		if err != nil {
			Fail(c, http.StatusNotFound, "not_found", "conf not found")
			return
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			Fail(c, http.StatusBadGateway, "conf_error", err.Error())
			return
		}
		JSON(c, gin.H{"id": id, "path": path, "content": string(raw)})
		return
	}
	raw, err := os.ReadFile(conf.Path)
	if err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	JSON(c, gin.H{"id": conf.ID, "path": conf.Path, "content": string(raw)})
}

func (s *Server) putModuleConf(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	paths := modules.ResolvePaths(rt.Cfg)
	id := c.Param("id")
	path := ""
	if conf, ok := modules.FindConfForModule(paths.EtcModulesDir, id); ok {
		path = conf.Path
	} else {
		path, err = modules.ResolveModuleConf(paths.EtcModulesDir, id)
		if err != nil {
			Fail(c, http.StatusNotFound, "not_found", "conf not found")
			return
		}
	}
	var req struct {
		Content string `json:"content"`
		Confirm bool   `json:"confirm"`
		Reload  bool   `json:"reload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	if len(req.Content) > 2*1024*1024 {
		Fail(c, http.StatusBadRequest, "bad_request", "content too large")
		return
	}
	bak := path + ".bak." + time.Now().Format("20060102-150405")
	if raw, err := os.ReadFile(path); err == nil {
		_ = os.WriteFile(bak, raw, 0o644)
	}
	if err := os.WriteFile(path, []byte(req.Content), 0o644); err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	out := gin.H{"path": path, "backup": bak}
	if req.Reload && rt.SOAP != nil {
		if result, err := s.execSOAP(c, rt, "reload config"); err == nil {
			out["reload"] = result
		} else {
			out["reload_error"] = err.Error()
		}
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.conf.write", Detail: path, OK: true,
	})
	JSON(c, out)
}
