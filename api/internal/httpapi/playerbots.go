package httpapi

import (
	"bufio"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"acmanage/internal/gamelocale"
	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

var confKeyRe = regexp.MustCompile(`^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*(?:#.*)?$`)

func (s *Server) playerbotsOverview(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	prefix := rt.Cfg.Bots.AccountPrefix
	if prefix == "" {
		prefix = "rndbot"
	}
	ctx := c.Request.Context()
	authDB := quoteIdent(rt.Cfg.MySQL.AuthDB)
	botsDBName := quoteIdent(rt.Cfg.MySQL.PlayerbotsDB)

	out := gin.H{
		"account_prefix":     prefix,
		"rndbot_accounts":    0,
		"addclass_accounts":  0,
		"altbot_links":       0,
		"online_bots":        0,
		"online_rndbot":      0,
		"online_addclass":    0,
		"account_type_ready": false,
	}

	if rt.DB.Playerbots == nil {
		// Fallback: prefix heuristic when playerbots DB is down.
		like := prefix + "%"
		var accountTotal, onlineBots int
		_ = rt.DB.Auth.QueryRowContext(ctx, `SELECT COUNT(*) FROM account WHERE username LIKE ?`, like).Scan(&accountTotal)
		_ = rt.DB.Characters.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM characters c
JOIN `+authDB+`.account a ON a.id = c.account
WHERE c.online = 1 AND a.username LIKE ?`, like).Scan(&onlineBots)
		out["rndbot_accounts"] = accountTotal
		out["online_bots"] = onlineBots
		out["online_rndbot"] = onlineBots
		JSON(c, out)
		return
	}

	rows, err := rt.DB.Playerbots.QueryContext(ctx, `
SELECT account_type, COUNT(*) FROM playerbots_account_type
WHERE account_type IN (1, 2)
GROUP BY account_type`)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	var rndAccounts, addClassAccounts int
	for rows.Next() {
		var typ, n int
		if err := rows.Scan(&typ, &n); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		switch typ {
		case 1:
			rndAccounts = n
		case 2:
			addClassAccounts = n
		}
	}

	var altLinks int
	_ = rt.DB.Playerbots.QueryRowContext(ctx, `
SELECT COUNT(*) FROM playerbots_account_links`).Scan(&altLinks)

	var onlineRnd, onlineAdd int
	_ = rt.DB.Characters.QueryRowContext(ctx, `
SELECT
  COALESCE(SUM(CASE WHEN t.account_type = 1 THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN t.account_type = 2 THEN 1 ELSE 0 END), 0)
FROM characters c
JOIN `+botsDBName+`.playerbots_account_type t ON t.account_id = c.account
WHERE c.online = 1 AND t.account_type IN (1, 2)`).Scan(&onlineRnd, &onlineAdd)

	out["rndbot_accounts"] = rndAccounts
	out["addclass_accounts"] = addClassAccounts
	out["altbot_links"] = altLinks
	out["online_rndbot"] = onlineRnd
	out["online_addclass"] = onlineAdd
	out["online_bots"] = onlineRnd + onlineAdd
	out["account_type_ready"] = true
	JSON(c, out)
}

func (s *Server) playerbotsStats(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	result, err := s.execSOAP(c, rt, "playerbot rndbot stats")
	if err != nil {
		return
	}
	JSON(c, gin.H{"raw": result})
}

func (s *Server) playerbotsOnline(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	prefix := rt.Cfg.Bots.AccountPrefix
	if prefix == "" {
		prefix = "rndbot"
	}
	like := prefix + "%"
	authDB := quoteIdent(rt.Cfg.MySQL.AuthDB)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 300 {
		limit = 100
	}
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT c.guid, c.name, a.username, c.race, c.class, c.level, c.map, c.zone
FROM characters c
JOIN `+authDB+`.account a ON a.id = c.account
WHERE c.online = 1 AND a.username LIKE ?
ORDER BY c.level DESC
LIMIT ?`, like, limit)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	loc := i18n.FromRequest(c)
	items := []gin.H{}
	for rows.Next() {
		var guid uint32
		var name, account string
		var race, class, level uint8
		var mapID uint16
		var zone uint32
		if err := rows.Scan(&guid, &name, &account, &race, &class, &level, &mapID, &zone); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"guid": guid, "name": name, "account": account,
			"race": race, "race_name": gamelocale.RaceName(int(race), loc),
			"class": class, "class_name": gamelocale.ClassName(int(class), loc),
			"level": level,
			"map": mapID, "map_name": gamelocale.MapName(int(mapID), loc),
			"zone": zone, "zone_name": gamelocale.AreaName(int(zone), loc),
		})
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) playerbotsRndbotAction(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	action := strings.ToLower(strings.TrimSpace(c.Param("action")))
	allowed := map[string]bool{
		"reload": true, "init": true, "reset": true, "level": true, "refresh": true, "teleport": true, "stats": true,
	}
	if !allowed[action] {
		Fail(c, http.StatusBadRequest, "bad_request", "unsupported action")
		return
	}
	var req struct {
		Arg     string `json:"arg"`
		Confirm bool   `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&req)
	if action != "stats" && action != "reload" && !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	cmd := "playerbot rndbot " + action
	if arg := strings.TrimSpace(req.Arg); arg != "" {
		if strings.ContainsAny(arg, " \t\n\"'`") {
			Fail(c, http.StatusBadRequest, "bad_request", "invalid arg")
			return
		}
		cmd += " " + arg
	}
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) playerbotsConfig(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	path := resolvePlayerbotsConfPath(rt.Cfg.Conf)
	if path == "" {
		JSON(c, gin.H{"available": false, "message": "playerbots.conf path not configured"})
		return
	}
	f, err := os.Open(path)
	if err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	defer f.Close()

	want := playerbotsEditableConfKeys()
	wantSet := make(map[string]struct{}, len(want))
	for _, p := range want {
		wantSet[strings.ToLower(p)] = struct{}{}
	}
	values := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		m := confKeyRe.FindStringSubmatch(line)
		if len(m) != 3 {
			continue
		}
		key, val := m[1], strings.Trim(m[2], `"'`)
		if _, ok := wantSet[strings.ToLower(key)]; !ok {
			continue
		}
		for _, p := range want {
			if strings.EqualFold(key, p) {
				values[p] = val
				break
			}
		}
	}
	JSON(c, gin.H{"available": true, "path": path, "values": values})
}

func (s *Server) serverLogs(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	if !rt.Cfg.Docker.Enabled || rt.Docker == nil {
		Fail(c, http.StatusBadRequest, "docker_disabled", "docker disabled for this target")
		return
	}
	tail := c.DefaultQuery("tail", "200")
	level := strings.ToLower(strings.TrimSpace(c.Query("level")))
	raw, err := rt.Docker.Logs(c.Request.Context(), c.Param("name"), tail)
	if err != nil {
		Fail(c, http.StatusBadGateway, "docker_error", err.Error())
		return
	}
	lines := strings.Split(raw, "\n")
	if level != "" {
		filtered := make([]string, 0, len(lines))
		for _, line := range lines {
			if strings.Contains(strings.ToLower(line), level) {
				filtered = append(filtered, line)
			}
		}
		lines = filtered
	}
	JSON(c, gin.H{"lines": lines, "count": len(lines)})
}
