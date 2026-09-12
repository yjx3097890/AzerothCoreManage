package httpapi

import (
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

func (*Server) playerbotsBots(c *gin.Context) {
	// mod-playerbots registers `playerbots bot` with Console::No and requires an
	// active player session ("You may only add bots from an active session").
	// SOAP has no session, so these cannot be executed remotely.
	Fail(c, http.StatusBadRequest, "playerbots_ingame_only",
		"playerbots bot requires an in-game player session; use .playerbots bot add|remove|addaccount|addclass in chat")
}

func (*Server) playerbotsAccount(c *gin.Context) {
	// Same as playerbots bot: Console::No + requires GetSession()->GetPlayer().
	Fail(c, http.StatusBadRequest, "playerbots_ingame_only",
		"playerbots account requires an in-game player session; use .playerbots account setKey|link|unlink|linkedAccounts in chat")
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
	allowed := make(map[string]bool, len(playerbotsEditableConfKeys()))
	for _, k := range playerbotsEditableConfKeys() {
		allowed[k] = true
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
		// Docker 运行时：etc/modules/playerbots.conf（与 docker/vol/etc 挂载一致）。
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

// playerbotsEditableConfKeys is the allow-list for GET/PUT /playerbots/config.
func playerbotsEditableConfKeys() []string {
	return []string{
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
		// Loot / equip / trade
		"AiPlayerbot.FreeMethodLoot",
		"AiPlayerbot.LootNeedRollLevel",
		"AiPlayerbot.LootGreedRollLevel",
		"AiPlayerbot.LootRollRecipe",
		"AiPlayerbot.LootRollDisenchant",
		"AiPlayerbot.LootDistance",
		"AiPlayerbot.LootDelay",
		"AiPlayerbot.AutoEquipUpgradeLoot",
		"AiPlayerbot.EquipUpgradeThreshold",
		"AiPlayerbot.EnableRandomBotTrading",
		"AiPlayerbot.RandomBotNonCombatStrategies",
		"AiPlayerbot.NonCombatStrategies",
		// Battlegrounds & arenas
		"AiPlayerbot.RandomBotJoinBG",
		"AiPlayerbot.RandomBotAutoJoinBG",
		"AiPlayerbot.RandomBotAutoJoinICBrackets",
		"AiPlayerbot.RandomBotAutoJoinEYBrackets",
		"AiPlayerbot.RandomBotAutoJoinAVBrackets",
		"AiPlayerbot.RandomBotAutoJoinABBrackets",
		"AiPlayerbot.RandomBotAutoJoinWSBrackets",
		"AiPlayerbot.RandomBotAutoJoinBGICCount",
		"AiPlayerbot.RandomBotAutoJoinBGEYCount",
		"AiPlayerbot.RandomBotAutoJoinBGAVCount",
		"AiPlayerbot.RandomBotAutoJoinBGABCount",
		"AiPlayerbot.RandomBotAutoJoinBGWSCount",
		"AiPlayerbot.RandomBotAutoJoinArenaBracket",
		"AiPlayerbot.RandomBotAutoJoinBGRatedArena2v2Count",
		"AiPlayerbot.RandomBotAutoJoinBGRatedArena3v3Count",
		"AiPlayerbot.RandomBotAutoJoinBGRatedArena5v5Count",
		"AiPlayerbot.RandomBotArenaTeam2v2Count",
		"AiPlayerbot.RandomBotArenaTeam3v3Count",
		"AiPlayerbot.RandomBotArenaTeam5v5Count",
		"AiPlayerbot.RandomBotArenaTeamMaxRating",
		"AiPlayerbot.RandomBotArenaTeamMinRating",
		"AiPlayerbot.DeleteRandomBotArenaTeams",
		"AiPlayerbot.FastReactInBG",
	}
}
