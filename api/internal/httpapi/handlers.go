package httpapi

import (
	"context"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"acmanage/internal/app"
	"acmanage/internal/audit"

	"github.com/gin-gonic/gin"
)

func (s *Server) health(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	status := gin.H{
		"api":    "ok",
		"target": rt.Cfg.ID,
		"soap":   "skipped",
		"mysql":  "skipped",
		"docker": "disabled",
	}

	if rt.SOAP != nil {
		if _, err := rt.SOAP.Execute(ctx, "server info"); err != nil {
			status["soap"] = err.Error()
		} else {
			status["soap"] = "ok"
		}
	}

	if err := s.app.EnsureMySQL(rt); err != nil {
		status["mysql"] = err.Error()
	} else if err := rt.DB.Ping(ctx); err != nil {
		status["mysql"] = err.Error()
	} else {
		status["mysql"] = "ok"
		if rt.DB.Playerbots == nil {
			status["mysql_playerbots"] = "unavailable"
		} else {
			status["mysql_playerbots"] = "ok"
		}
	}

	if rt.Cfg.Docker.Enabled {
		if rt.Docker == nil {
			status["docker"] = "not connected"
		} else if err := rt.Docker.Ping(ctx); err != nil {
			status["docker"] = err.Error()
		} else {
			status["docker"] = "ok"
		}
	}

	JSON(c, status)
}

func (s *Server) login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	role := ""
	if req.Username == s.app.Cfg.Panel.AdminUsername && req.Password == s.app.Cfg.Panel.AdminPassword {
		role = RoleSuperAdmin
	}
	if role == "" {
		FailCode(c, http.StatusUnauthorized, "invalid_credentials")
		return
	}
	token, err := SignToken(s.app.Cfg.Panel.JWTSecret, req.Username, role, 12*time.Hour)
	if err != nil {
		FailCode(c, http.StatusInternalServerError, "token")
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: req.Username,
		Role:     role,
		TargetID: "",
		Action:   "auth.login",
		Detail:   "panel login",
		OK:       true,
	})
	JSON(c, gin.H{
		"token": token,
		"user":  gin.H{"username": req.Username, "role": role},
	})
}

func (s *Server) me(c *gin.Context) {
	JSON(c, gin.H{
		"username": Username(c),
		"role":     Role(c),
	})
}

func (s *Server) listTargets(c *gin.Context) {
	items := make([]gin.H, 0, len(s.app.Cfg.Targets))
	for _, t := range s.app.Cfg.Targets {
		items = append(items, gin.H{
			"id":            t.ID,
			"name":          t.Name,
			"docker_enabled": t.Docker.Enabled,
		})
	}
	JSON(c, gin.H{"items": items})
}

var (
	rePlayers = regexp.MustCompile(`(?i)Connected players:\s*(\d+)`)
	reChars   = regexp.MustCompile(`(?i)Characters in world:\s*(\d+)`)
	rePeak    = regexp.MustCompile(`(?i)Connection peak:\s*(\d+)`)
	reUptime  = regexp.MustCompile(`(?i)Server uptime:\s*(.+)`)
	reRev     = regexp.MustCompile(`(?i)^(AzerothCore .+)$`)
	reMean    = regexp.MustCompile(`(?i)Mean:\s*(\d+)ms`)
	reMedian  = regexp.MustCompile(`(?i)Median:\s*(\d+)ms`)
	reP95     = regexp.MustCompile(`(?i)Percentiles \(95,\s*99,\s*max\):\s*(\d+)ms,\s*(\d+)ms,\s*(\d+)ms`)
	reDiff    = regexp.MustCompile(`(?i)Update time diff:\s*(\d+)ms`)
)

type serverInfoParsed struct {
	Raw               string `json:"raw"`
	Version           string `json:"version"`
	ConnectedPlayers  int    `json:"connected_players"`
	CharactersInWorld int    `json:"characters_in_world"`
	ConnectionPeak    int    `json:"connection_peak"`
	Uptime            string `json:"uptime"`
	UpdateDiffMS      int    `json:"update_diff_ms"`
	MeanMS            int    `json:"mean_ms"`
	MedianMS          int    `json:"median_ms"`
	P95MS             int    `json:"p95_ms"`
	P99MS             int    `json:"p99_ms"`
	MaxMS             int    `json:"max_ms"`
}

func parseServerInfo(raw string) serverInfoParsed {
	p := serverInfoParsed{Raw: raw}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if m := reRev.FindStringSubmatch(line); len(m) == 2 && p.Version == "" {
			p.Version = m[1]
		}
		if m := rePlayers.FindStringSubmatch(line); len(m) == 2 {
			p.ConnectedPlayers, _ = strconv.Atoi(m[1])
		}
		if m := reChars.FindStringSubmatch(line); len(m) == 2 {
			p.CharactersInWorld, _ = strconv.Atoi(m[1])
		}
		if m := rePeak.FindStringSubmatch(line); len(m) == 2 {
			p.ConnectionPeak, _ = strconv.Atoi(m[1])
		}
		if m := reUptime.FindStringSubmatch(line); len(m) == 2 {
			p.Uptime = strings.TrimSuffix(strings.TrimSpace(m[1]), ".")
		}
		if m := reDiff.FindStringSubmatch(line); len(m) == 2 {
			p.UpdateDiffMS, _ = strconv.Atoi(m[1])
		}
		if m := reMean.FindStringSubmatch(line); len(m) == 2 {
			p.MeanMS, _ = strconv.Atoi(m[1])
		}
		if m := reMedian.FindStringSubmatch(line); len(m) == 2 {
			p.MedianMS, _ = strconv.Atoi(m[1])
		}
		if m := reP95.FindStringSubmatch(line); len(m) == 4 {
			p.P95MS, _ = strconv.Atoi(m[1])
			p.P99MS, _ = strconv.Atoi(m[2])
			p.MaxMS, _ = strconv.Atoi(m[3])
		}
	}
	return p
}

func (s *Server) dashboardOverview(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	out := gin.H{
		"target": rt.Cfg.ID,
	}

	if rt.SOAP != nil {
		raw, err := rt.SOAP.Execute(ctx, "server info")
		if err != nil {
			out["server_info_error"] = err.Error()
		} else {
			out["server_info"] = parseServerInfo(raw)
		}
	}

	realOnline, botOnline := 0, 0
	if err := s.app.EnsureMySQL(rt); err == nil && rt.DB != nil {
		prefix := rt.Cfg.Bots.AccountPrefix
		if prefix == "" {
			prefix = "rndbot"
		}
		like := prefix + "%"
		authDB := rt.Cfg.MySQL.AuthDB
		q := `
SELECT
  COALESCE(SUM(CASE WHEN a.username LIKE ? THEN 1 ELSE 0 END), 0) AS bots,
  COALESCE(SUM(CASE WHEN a.username LIKE ? THEN 0 ELSE 1 END), 0) AS real_players
FROM characters c
JOIN ` + "`" + authDB + "`" + `.account a ON a.id = c.account
WHERE c.online = 1`
		_ = rt.DB.Characters.QueryRowContext(ctx, q, like, like).Scan(&botOnline, &realOnline)
		out["online"] = gin.H{
			"real_players": realOnline,
			"bots":         botOnline,
			"total":        realOnline + botOnline,
		}
	} else if err != nil {
		out["online_error"] = err.Error()
	}

	containers := []any{}
	if rt.Cfg.Docker.Enabled && rt.Docker != nil {
		list, err := rt.Docker.List(ctx)
		if err != nil {
			out["containers_error"] = err.Error()
		} else {
			for _, item := range list {
				containers = append(containers, item)
			}
		}
	}
	out["containers"] = containers
	out["docker_enabled"] = rt.Cfg.Docker.Enabled

	JSON(c, out)
}

func (s *Server) listServers(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	if !rt.Cfg.Docker.Enabled {
		JSON(c, gin.H{"enabled": false, "items": []any{}, "message": "docker disabled for this target"})
		return
	}
	if rt.Docker == nil {
		Fail(c, http.StatusServiceUnavailable, "docker_unavailable", "docker client not available")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	items, err := rt.Docker.List(ctx)
	if err != nil {
		Fail(c, http.StatusBadGateway, "docker_error", err.Error())
		return
	}
	JSON(c, gin.H{"enabled": true, "items": items})
}

func (s *Server) serverAction(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		rt, err := s.app.Target(TargetID(c))
		if err != nil {
			FailCode(c, http.StatusBadRequest, "bad_target")
			return
		}
		if !rt.Cfg.Docker.Enabled || rt.Docker == nil {
			Fail(c, http.StatusBadRequest, "docker_disabled", "docker disabled for this target")
			return
		}
		name := c.Param("name")
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()
		var opErr error
		switch action {
		case "start":
			opErr = rt.Docker.Start(ctx, name)
		case "stop":
			opErr = rt.Docker.Stop(ctx, name)
		case "restart":
			opErr = rt.Docker.Restart(ctx, name)
		default:
			FailCode(c, http.StatusBadRequest, "bad_request")
			return
		}
		_ = s.app.Audit.Write(ctx, audit.Entry{
			Username: Username(c),
			Role:     Role(c),
			TargetID: rt.Cfg.ID,
			Action:   "docker." + action,
			Detail:   name,
			OK:       opErr == nil,
			Error:    errString(opErr),
		})
		if opErr != nil {
			Fail(c, http.StatusBadGateway, "docker_error", opErr.Error())
			return
		}
		JSON(c, gin.H{"ok": true, "action": action, "name": name})
	}
}

func (s *Server) serverLifecycle(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"`
		Delay   int    `json:"delay"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	cmd := ""
	switch req.Action {
	case "restart":
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		if req.Delay <= 0 {
			req.Delay = 30
		}
		cmd = "server restart " + strconv.Itoa(req.Delay)
	case "shutdown":
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		if req.Delay <= 0 {
			req.Delay = 30
		}
		cmd = "server shutdown " + strconv.Itoa(req.Delay)
	case "restart_cancel":
		cmd = "server restart cancel"
	case "shutdown_cancel":
		cmd = "server shutdown cancel"
	default:
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) runSOAP(c *gin.Context, rt *app.TargetRuntime, command string) (string, error) {
	if err := s.app.Guard.Check(command); err != nil {
		_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
			Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
			Action: "soap.exec", Detail: command, OK: false, Error: err.Error(),
		})
		return "", err
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	result, err := rt.SOAP.Execute(ctx, command)
	_ = s.app.Audit.Write(ctx, audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "soap.exec", Detail: command, OK: err == nil, Error: errString(err),
	})
	return result, err
}

func (s *Server) execSOAP(c *gin.Context, rt *app.TargetRuntime, command string) (string, error) {
	result, err := s.runSOAP(c, rt, command)
	if err != nil {
		if strings.Contains(err.Error(), "not allowed") || strings.Contains(err.Error(), "denied") || strings.Contains(err.Error(), "allow-list") {
			Fail(c, http.StatusForbidden, "command_denied", err.Error())
		} else {
			Fail(c, http.StatusBadGateway, "soap_error", err.Error())
		}
		return "", err
	}
	return result, nil
}

func (s *Server) listAudit(c *gin.Context) {
	items, err := s.app.Audit.List(c.Request.Context(), 100)
	if err != nil {
		Fail(c, http.StatusInternalServerError, "audit_error", err.Error())
		return
	}
	JSON(c, gin.H{"items": items})
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
