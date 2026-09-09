package httpapi

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"acmanage/internal/config"

	"github.com/gin-gonic/gin"
)

func (s *Server) playerbotsPmon(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // toggle|stack|tick|reset
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	allowed := map[string]bool{"toggle": true, "stack": true, "tick": true, "reset": true}
	if !allowed[action] {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if (action == "toggle" || action == "reset") && !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	cmd := "playerbot pmon " + action
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) playerbotsBots(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // add|remove|addaccount|addclass
		Name    string `json:"name"`
		Account string `json:"account"`
		Class   string `json:"class"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	var cmd string
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "add":
		name, err := sanitizeCharName(req.Name)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		cmd = "playerbots bot add " + name
	case "remove":
		name, err := sanitizeCharName(req.Name)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		cmd = "playerbots bot remove " + name
	case "addaccount":
		acc, err := sanitizeAccountName(req.Account)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		cmd = "playerbots bot addaccount " + acc
	case "addclass":
		cls := strings.ToLower(strings.TrimSpace(req.Class))
		if cls == "" || strings.ContainsAny(cls, " \t\n\"'`") {
			Fail(c, http.StatusBadRequest, "bad_request", "class required")
			return
		}
		cmd = "playerbots bot addclass " + cls
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

func (s *Server) playerbotsAccount(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // link|unlink|list|setkey
		Account string `json:"account"`
		Key     string `json:"key"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	var cmd string
	switch action {
	case "list", "linkedaccounts":
		cmd = "playerbots account linkedAccounts"
	case "link":
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		acc, err := sanitizeAccountName(req.Account)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		key := strings.TrimSpace(req.Key)
		if key == "" || strings.ContainsAny(key, " \t\n\"'`") {
			Fail(c, http.StatusBadRequest, "bad_request", "key required")
			return
		}
		cmd = fmt.Sprintf("playerbots account link %s %s", acc, key)
	case "unlink":
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		acc, err := sanitizeAccountName(req.Account)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		cmd = "playerbots account unlink " + acc
	case "setkey":
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		key := strings.TrimSpace(req.Key)
		if key == "" || strings.ContainsAny(key, " \t\n\"'`") {
			Fail(c, http.StatusBadRequest, "bad_request", "key required")
			return
		}
		cmd = "playerbots account setKey " + key
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

func (s *Server) playerbotsGuilds(c *gin.Context) {
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
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT g.guildid, g.name, COUNT(*) AS bot_members
FROM guild g
JOIN guild_member gm ON gm.guildid = g.guildid
JOIN characters c ON c.guid = gm.guid
JOIN `+authDB+`.account a ON a.id = c.account
WHERE a.username LIKE ?
GROUP BY g.guildid, g.name
HAVING bot_members > 0
ORDER BY bot_members DESC
LIMIT 100`, like)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, bots uint32
		var name string
		if err := rows.Scan(&id, &name, &bots); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{"id": id, "name": name, "bot_members": bots})
	}
	JSON(c, gin.H{"items": items, "account_prefix": prefix})
}

func (s *Server) playerbotsConfigUpdate(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Values  map[string]string `json:"values"`
		Confirm bool              `json:"confirm"`
		Reload  bool              `json:"reload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	path := resolvePlayerbotsConfPath(rt.Cfg.Conf)
	if path == "" {
		Fail(c, http.StatusBadRequest, "conf_error", "playerbots.conf path not configured")
		return
	}
	allowed := map[string]bool{
		"AiPlayerbot.RandomBotAutologin": true, "AiPlayerbot.MinRandomBots": true, "AiPlayerbot.MaxRandomBots": true,
		"AiPlayerbot.RandomBotMinLevel": true, "AiPlayerbot.RandomBotMaxLevel": true,
		"AiPlayerbot.DisableDeathKnightLogin": true, "AiPlayerbot.RandomBotAccountPrefix": true,
		"AiPlayerbot.RandomBotAccountCount": true, "AiPlayerbot.AutoGearQuality": true,
		"AiPlayerbot.RandomBotTimedLogout": true, "AiPlayerbot.RandomBotTimedOffline": true,
	}
	updates := map[string]string{}
	for k, v := range req.Values {
		if !allowed[k] {
			Fail(c, http.StatusBadRequest, "bad_request", "key not allowed: "+k)
			return
		}
		if strings.ContainsAny(v, "\n\r") {
			Fail(c, http.StatusBadRequest, "bad_request", "invalid value")
			return
		}
		updates[k] = v
	}
	if len(updates) == 0 {
		Fail(c, http.StatusBadRequest, "bad_request", "no values")
		return
	}
	if err := updateConfKeys(path, updates); err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	out := gin.H{"path": path, "updated": updates}
	if req.Reload {
		if result, err := s.runSOAP(c, rt, "playerbot rndbot reload"); err == nil {
			out["reload"] = result
		} else {
			out["reload_error"] = err.Error()
		}
	}
	JSON(c, out)
}

func resolvePlayerbotsConfPath(conf config.ConfPaths) string {
	if conf.PlayerbotsConf != "" {
		return conf.PlayerbotsConf
	}
	if conf.EtcDir != "" {
		// Docker 常见：conf/modules/playerbots.conf；也兼容 etc 根目录。
		candidates := []string{
			filepath.Join(conf.EtcDir, "modules", "playerbots.conf"),
			filepath.Join(conf.EtcDir, "playerbots.conf"),
		}
		for _, p := range candidates {
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
		return candidates[0]
	}
	return ""
}
