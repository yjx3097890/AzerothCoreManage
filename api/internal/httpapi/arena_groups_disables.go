package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"acmanage/internal/app"
	"acmanage/internal/gamelocale"
	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

func (s *Server) listArenaTeams(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	where := "WHERE 1=1"
	args := []any{}
	if q != "" {
		where += " AND a.name LIKE ?"
		args = append(args, "%"+q+"%")
	}
	args = append(args, limit)
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT a.arenaTeamId, a.name, a.captainGuid, COALESCE(c.name,''), a.type, a.rating,
       a.seasonGames, a.seasonWins, a.weekGames, a.weekWins, a.rank
FROM arena_team a
LEFT JOIN characters c ON c.guid = a.captainGuid
`+where+`
ORDER BY a.rating DESC
LIMIT ?`, args...)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, captain, rating, seasonGames, seasonWins, weekGames, weekWins, rank uint32
		var name, captainName string
		var typ uint8
		if err := rows.Scan(&id, &name, &captain, &captainName, &typ, &rating, &seasonGames, &seasonWins, &weekGames, &weekWins, &rank); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"id": id, "name": name, "captain_guid": captain, "captain_name": captainName,
			"type": typ, "rating": rating, "season_games": seasonGames, "season_wins": seasonWins,
			"week_games": weekGames, "week_wins": weekWins, "rank": rank,
		})
	}
	season := gin.H{}
	var seasonID, seasonState uint32
	if err := rt.DB.Characters.QueryRowContext(c.Request.Context(),
		`SELECT season_id, season_state FROM active_arena_season LIMIT 1`).Scan(&seasonID, &seasonState); err == nil {
		season = gin.H{"season_id": seasonID, "season_state": seasonState}
	}
	JSON(c, gin.H{"items": items, "season": season})
}

func (s *Server) getArenaTeam(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT m.guid, COALESCE(c.name,''), m.weekGames, m.weekWins, m.seasonGames, m.seasonWins, m.personalRating
FROM arena_team_member m
LEFT JOIN characters c ON c.guid = m.guid
WHERE m.arenaTeamId = ?
ORDER BY m.personalRating DESC`, id)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	members := []gin.H{}
	for rows.Next() {
		var guid, wg, ww, sg, sw, rating uint32
		var name string
		if err := rows.Scan(&guid, &name, &wg, &ww, &sg, &sw, &rating); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		members = append(members, gin.H{
			"guid": guid, "name": name, "week_games": wg, "week_wins": ww,
			"season_games": sg, "season_wins": sw, "personal_rating": rating,
		})
	}
	JSON(c, gin.H{"id": id, "members": members})
}

func (s *Server) arenaSeasonAction(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // start | set_state | reward | deleteteams
		ID      int    `json:"id"`
		State   *int   `json:"state"`
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
	case "start":
		if req.ID <= 0 {
			Fail(c, http.StatusBadRequest, "bad_request", "id required")
			return
		}
		cmd = fmt.Sprintf("arena season start %d", req.ID)
	case "set_state":
		if req.State == nil || (*req.State != 0 && *req.State != 1) {
			Fail(c, http.StatusBadRequest, "bad_request", "state must be 0|1")
			return
		}
		cmd = fmt.Sprintf("arena season set state %d", *req.State)
	case "reward":
		cmd = "arena season reward all"
	case "deleteteams":
		cmd = "arena season deleteteams"
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

func (s *Server) listGroups(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT g.guid, g.leaderGuid, COALESCE(c.name,''), g.groupType, g.difficulty, g.raidDifficulty,
       (SELECT COUNT(*) FROM group_member gm WHERE gm.guid = g.guid) AS members
FROM groups g
LEFT JOIN characters c ON c.guid = g.leaderGuid
ORDER BY g.guid DESC
LIMIT ?`, limit)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var guid, leader uint32
		var leaderName string
		var groupType, difficulty, raidDiff uint8
		var members int
		if err := rows.Scan(&guid, &leader, &leaderName, &groupType, &difficulty, &raidDiff, &members); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"guid": guid, "leader_guid": leader, "leader_name": leaderName,
			"group_type": groupType, "difficulty": difficulty, "raid_difficulty": raidDiff, "members": members,
		})
	}
	JSON(c, gin.H{"items": items, "readonly": true})
}

func (s *Server) getGroup(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT gm.memberGuid, COALESCE(c.name,''), gm.memberFlags, gm.subgroup, gm.roles, c.online
FROM group_member gm
LEFT JOIN characters c ON c.guid = gm.memberGuid
WHERE gm.guid = ?
ORDER BY gm.subgroup, c.name`, id)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	members := []gin.H{}
	for rows.Next() {
		var guid uint32
		var name string
		var flags, subgroup, roles, online uint8
		if err := rows.Scan(&guid, &name, &flags, &subgroup, &roles, &online); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		members = append(members, gin.H{
			"guid": guid, "name": name, "flags": flags, "subgroup": subgroup, "roles": roles, "online": online,
		})
	}
	JSON(c, gin.H{"guid": id, "members": members})
}

func (s *Server) listDisables(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	sourceType := strings.TrimSpace(c.Query("sourceType"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := "WHERE 1=1"
	args := []any{}
	if sourceType != "" {
		where += " AND sourceType = ?"
		args = append(args, sourceType)
	}
	args = append(args, limit)
	rows, err := rt.DB.World.QueryContext(c.Request.Context(), `
SELECT sourceType, entry, flags, COALESCE(params_0,''), COALESCE(params_1,''), COALESCE(comment,'')
FROM disables
`+where+`
ORDER BY sourceType, entry
LIMIT ?`, args...)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	type disableRow struct {
		sourceType, entry, flags uint32
		p0, p1, comment          string
	}
	raw := make([]disableRow, 0, 64)
	questIDs := map[uint32]struct{}{}
	for rows.Next() {
		var r disableRow
		if err := rows.Scan(&r.sourceType, &r.entry, &r.flags, &r.p0, &r.p1, &r.comment); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		raw = append(raw, r)
		switch r.sourceType {
		case gamelocale.DisableQuest:
			questIDs[r.entry] = struct{}{}
		}
	}

	loc := i18n.FromRequest(c)
	questNames := loadQuestNames(c, rt, questIDs, loc == i18n.ZH)

	items := make([]gin.H, 0, len(raw))
	for _, r := range raw {
		entryName := disableEntryName(int(r.sourceType), int(r.entry), questNames, loc)
		commentZH := gamelocale.LocalizeDisableComment(r.comment, loc)
		items = append(items, gin.H{
			"source_type":      r.sourceType,
			"source_type_name": gamelocale.DisableSourceName(int(r.sourceType), loc),
			"entry":            r.entry,
			"entry_name":       entryName,
			"flags":            r.flags,
			"flags_text":       gamelocale.DisableFlagsText(int(r.sourceType), r.flags, loc),
			"params_0":         r.p0,
			"params_1":         r.p1,
			"comment":          commentZH,
			"comment_en":       r.comment,
		})
	}
	JSON(c, gin.H{"items": items})
}

func disableEntryName(sourceType, entry int, questNames map[uint32]string, loc i18n.Locale) string {
	switch sourceType {
	case gamelocale.DisableQuest:
		if n := questNames[uint32(entry)]; n != "" {
			return n
		}
	case gamelocale.DisableMap, gamelocale.DisableBattleground, gamelocale.DisableVMAP,
		gamelocale.DisableLFGMap, gamelocale.DisableGOLOS:
		if n := gamelocale.MapName(entry, loc); n != "" {
			return n
		}
	case gamelocale.DisableGameEvent:
		if n, _ := gamelocale.NameForEvent(entry, "", loc); n != "" {
			return n
		}
	}
	return ""
}

func loadQuestNames(c *gin.Context, rt *app.TargetRuntime, ids map[uint32]struct{}, preferZH bool) map[uint32]string {
	out := map[uint32]string{}
	if len(ids) == 0 {
		return out
	}
	list := make([]any, 0, len(ids))
	ph := make([]string, 0, len(ids))
	for id := range ids {
		list = append(list, id)
		ph = append(ph, "?")
	}
	q := `
SELECT qt.ID, qt.LogTitle, COALESCE(NULLIF(ql.Title,''), '')
FROM quest_template qt
LEFT JOIN quest_template_locale ql ON ql.ID = qt.ID AND ql.locale = 'zhCN'
WHERE qt.ID IN (` + strings.Join(ph, ",") + `)`
	rows, err := rt.DB.World.QueryContext(c.Request.Context(), q, list...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id uint32
		var en, zh string
		if err := rows.Scan(&id, &en, &zh); err != nil {
			continue
		}
		name := en
		if preferZH && zh != "" {
			name = zh
		} else if name == "" {
			name = zh
		}
		if name != "" {
			out[id] = name
		}
	}
	return out
}

func (s *Server) disableAction(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // add | remove | reload
		Type    string `json:"type"`   // spell|map|battleground|quest|vmap|outdoorpvp
		Entry   int    `json:"entry"`
		Flag    int    `json:"flag"`
		Comment string `json:"comment"`
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
	case "reload":
		cmd = "reload disables"
	case "add":
		typ := strings.ToLower(strings.TrimSpace(req.Type))
		allowed := map[string]bool{"spell": true, "map": true, "battleground": true, "quest": true, "vmap": true, "outdoorpvp": true}
		if !allowed[typ] || req.Entry <= 0 {
			Fail(c, http.StatusBadRequest, "bad_request", "type/entry required")
			return
		}
		comment := sanitizeMailText(req.Comment, 64)
		if comment == "" {
			comment = "panel"
		}
		cmd = fmt.Sprintf("disable add %s %d %d %s", typ, req.Entry, req.Flag, comment)
	case "remove":
		typ := strings.ToLower(strings.TrimSpace(req.Type))
		if typ == "" || req.Entry <= 0 {
			Fail(c, http.StatusBadRequest, "bad_request", "type/entry required")
			return
		}
		cmd = fmt.Sprintf("disable remove %s %d", typ, req.Entry)
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
