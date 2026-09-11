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
	like := prefix + "%"
	ctx := c.Request.Context()

	var accountTotal int
	_ = rt.DB.Auth.QueryRowContext(ctx, `SELECT COUNT(*) FROM account WHERE username LIKE ?`, like).Scan(&accountTotal)

	authDB := quoteIdent(rt.Cfg.MySQL.AuthDB)
	var onlineBots int
	_ = rt.DB.Characters.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM characters c
JOIN `+authDB+`.account a ON a.id = c.account
WHERE c.online = 1 AND a.username LIKE ?`, like).Scan(&onlineBots)

	JSON(c, gin.H{
		"account_prefix":  prefix,
		"rndbot_accounts": accountTotal,
		"online_bots":     onlineBots,
		"note_key":        "prefix_stats_only",
	})
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

	wantPrefixes := []string{
		"AiPlayerbot.RandomBotAutologin",
		"AiPlayerbot.BotAutologin",
		"AiPlayerbot.MinRandomBots",
		"AiPlayerbot.MaxRandomBots",
		"AiPlayerbot.RandomBotMinLevel",
		"AiPlayerbot.RandomBotMaxLevel",
		"AiPlayerbot.DisableDeathKnightLogin",
		"AiPlayerbot.RandomBotAccountPrefix",
		"AiPlayerbot.RandomBotAccountCount",
		"AiPlayerbot.AutoGearQualityLimit",
		"AiPlayerbot.EnablePeriodicOnlineOffline",
		"AiPlayerbot.PeriodicOnlineOfflineRatio",
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
		for _, p := range wantPrefixes {
			if strings.EqualFold(key, p) {
				values[p] = val
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
