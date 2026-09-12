package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"acmanage/internal/gamelocale"
	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

type characterListRow struct {
	GUID      uint32     `json:"guid"`
	AccountID uint32     `json:"account_id"`
	Account   string     `json:"account"`
	Name      string     `json:"name"`
	Race      uint8      `json:"race"`
	Class     uint8      `json:"class"`
	ClassName string     `json:"class_name,omitempty"`
	Gender    uint8      `json:"gender"`
	Level     uint8      `json:"level"`
	Online    int        `json:"online"`
	Map       uint16     `json:"map"`
	MapName   string     `json:"map_name,omitempty"`
	Zone      uint32     `json:"zone"`
	ZoneName  string     `json:"zone_name,omitempty"`
	Money     uint32     `json:"money"`
	Logout    *time.Time `json:"logout_time"`
}

type characterDetail struct {
	characterListRow
	XP          uint32  `json:"xp"`
	TotalTime   uint32  `json:"totaltime"`
	PositionX   float32 `json:"position_x"`
	PositionY   float32 `json:"position_y"`
	PositionZ   float32 `json:"position_z"`
	Orientation float32 `json:"orientation"`
}

func (s *Server) listCharacters(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	account := strings.TrimSpace(c.Query("account"))
	onlineOnly := c.Query("online") == "1" || strings.EqualFold(c.Query("online"), "true")
	minLevel, _ := strconv.Atoi(c.Query("min_level"))
	maxLevel, _ := strconv.Atoi(c.Query("max_level"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	authDB := quoteIdent(rt.Cfg.MySQL.AuthDB)
	where := "WHERE 1=1"
	args := []any{}
	if q != "" {
		where += " AND (c.name LIKE ? OR CAST(c.guid AS CHAR) = ?)"
		like := "%" + q + "%"
		args = append(args, like, q)
	}
	if account != "" {
		where += " AND a.username LIKE ?"
		args = append(args, "%"+account+"%")
	}
	if onlineOnly {
		where += " AND c.online = 1"
	}
	if minLevel > 0 {
		where += " AND c.level >= ?"
		args = append(args, minLevel)
	}
	if maxLevel > 0 {
		where += " AND c.level <= ?"
		args = append(args, maxLevel)
	}

	ctx := c.Request.Context()
	countQ := `
SELECT COUNT(*)
FROM characters c
JOIN ` + authDB + `.account a ON a.id = c.account
` + where
	var total int
	if err := rt.DB.Characters.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}

	listQ := `
SELECT c.guid, c.account, a.username, c.name, c.race, c.class, c.gender, c.level,
       c.online, c.map, c.zone, c.money, c.logout_time
FROM characters c
JOIN ` + authDB + `.account a ON a.id = c.account
` + where + `
ORDER BY c.online DESC, c.level DESC, c.guid DESC
LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := rt.DB.Characters.QueryContext(ctx, listQ, args...)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	items := make([]characterListRow, 0)
	for rows.Next() {
		var item characterListRow
		var logout sql.NullInt64
		if err := rows.Scan(
			&item.GUID, &item.AccountID, &item.Account, &item.Name, &item.Race, &item.Class, &item.Gender, &item.Level,
			&item.Online, &item.Map, &item.Zone, &item.Money, &logout,
		); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		if logout.Valid && logout.Int64 > 0 {
			t := time.Unix(logout.Int64, 0)
			item.Logout = &t
		}
		loc := i18n.FromRequest(c)
		item.MapName = gamelocale.MapName(int(item.Map), loc)
		item.ZoneName = gamelocale.AreaName(int(item.Zone), loc)
		item.ClassName = gamelocale.ClassName(int(item.Class), loc)
		items = append(items, item)
	}
	JSON(c, gin.H{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) getCharacter(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	authDB := quoteIdent(rt.Cfg.MySQL.AuthDB)
	q := `
SELECT c.guid, c.account, a.username, c.name, c.race, c.class, c.gender, c.level,
       c.online, c.map, c.zone, c.money, c.logout_time,
       c.xp, c.totaltime, c.position_x, c.position_y, c.position_z, c.orientation
FROM characters c
JOIN ` + authDB + `.account a ON a.id = c.account
WHERE c.name = ?
LIMIT 1`
	var item characterDetail
	var logout sql.NullInt64
	err = rt.DB.Characters.QueryRowContext(c.Request.Context(), q, name).Scan(
		&item.GUID, &item.AccountID, &item.Account, &item.Name, &item.Race, &item.Class, &item.Gender, &item.Level,
		&item.Online, &item.Map, &item.Zone, &item.Money, &logout,
		&item.XP, &item.TotalTime, &item.PositionX, &item.PositionY, &item.PositionZ, &item.Orientation,
	)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "character not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	if logout.Valid && logout.Int64 > 0 {
		t := time.Unix(logout.Int64, 0)
		item.Logout = &t
	}
	loc := i18n.FromRequest(c)
	item.MapName = gamelocale.MapName(int(item.Map), loc)
	item.ZoneName = gamelocale.AreaName(int(item.Zone), loc)
	item.ClassName = gamelocale.ClassName(int(item.Class), loc)
	JSON(c, item)
}

func (s *Server) kickCharacter(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
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
	cmd := "kick " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) teleportCharacter(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Action   string  `json:"action"`
		Location string  `json:"location"`
		Map      int     `json:"map"`
		X        float64 `json:"x"`
		Y        float64 `json:"y"`
		Z        float64 `json:"z"`
		Confirm  bool    `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var cmd string
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "unstuck", "":
		cmd = "unstuck " + name
	case "teleport", "name":
		cmd = fmt.Sprintf("teleport name %s %d %f %f %f", name, req.Map, req.X, req.Y, req.Z)
	case "tele":
		loc, err := sanitizeTeleLocation(req.Location)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		cmd = fmt.Sprintf("tele name %s %s", name, loc)
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

func (s *Server) listTeleLocations(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	mapFilter := -1
	if raw := strings.TrimSpace(c.Query("map")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
			mapFilter = v
		}
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	fetchLimit := limit
	if q != "" || mapFilter >= 0 {
		fetchLimit = 5000
	}
	rows, err := rt.DB.World.QueryContext(c.Request.Context(), `
SELECT id, name, map, position_x, position_y, position_z, orientation
FROM game_tele
ORDER BY name
LIMIT ?`, fetchLimit)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	loc := i18n.FromRequest(c)
	items := []gin.H{}
	for rows.Next() {
		var id uint32
		var name string
		var mapID uint16
		var x, y, z, o float32
		if err := rows.Scan(&id, &name, &mapID, &x, &y, &z, &o); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		if mapFilter >= 0 && int(mapID) != mapFilter {
			continue
		}
		mapName := gamelocale.MapName(int(mapID), loc)
		nameZH := gamelocale.TeleNameZH(name)
		display := gamelocale.TeleDisplayName(name, loc)
		if q != "" {
			hit := gamelocale.TeleNameMatches(name, q) ||
				strings.Contains(strconv.Itoa(int(id)), q) ||
				strings.Contains(strconv.Itoa(int(mapID)), q) ||
				gamelocale.MapNameMatches(int(mapID), q)
			if !hit {
				continue
			}
		}
		items = append(items, gin.H{
			"id": id, "name": name, "name_zh": nameZH, "display_name": display,
			"map": mapID, "map_name": mapName,
			"x": x, "y": y, "z": z, "orientation": o,
		})
		if len(items) >= limit {
			break
		}
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) createTeleLocation(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	var req struct {
		Name        string  `json:"name"`
		Map         int     `json:"map"`
		X           float64 `json:"x"`
		Y           float64 `json:"y"`
		Z           float64 `json:"z"`
		Orientation float64 `json:"orientation"`
		Confirm     bool    `json:"confirm"`
		Reload      bool    `json:"reload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	name, err := sanitizeTeleLocation(req.Name)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if req.Map < 0 {
		Fail(c, http.StatusBadRequest, "bad_request", "invalid map")
		return
	}
	ctx := c.Request.Context()
	var maxID uint32
	_ = rt.DB.World.QueryRowContext(ctx, `SELECT COALESCE(MAX(id),0) FROM game_tele`).Scan(&maxID)
	_, err = rt.DB.World.ExecContext(ctx, `
INSERT INTO game_tele (id, position_x, position_y, position_z, orientation, map, name)
VALUES (?, ?, ?, ?, ?, ?, ?)`, maxID+1, req.X, req.Y, req.Z, req.Orientation, req.Map, name)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	out := gin.H{"id": maxID + 1, "name": name, "map": req.Map, "x": req.X, "y": req.Y, "z": req.Z}
	if req.Reload {
		if result, err := s.runSOAP(c, rt, "reload tele"); err == nil {
			out["reload"] = result
		} else {
			out["reload_error"] = err.Error()
		}
	}
	JSON(c, out)
}

func (s *Server) deleteTeleLocation(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeTeleLocation(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
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
	cmd := "teleport del " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) characterChangeFaction(c *gin.Context) {
	s.characterFlagCommand(c, "character changefaction")
}

func (s *Server) characterChangeRace(c *gin.Context) {
	s.characterFlagCommand(c, "character changerace")
}

func (s *Server) characterFlagCommand(c *gin.Context, prefix string) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
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
	cmd := prefix + " " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func sanitizeTeleLocation(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return "", fmt.Errorf("invalid tele location")
	}
	for _, r := range name {
		if unicode.IsSpace(r) || r == '"' || r == '\'' || r == '`' || r == ';' {
			return "", fmt.Errorf("invalid tele location characters")
		}
	}
	return name, nil
}

func (s *Server) characterLevel(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Level   int  `json:"level"`
		Confirm bool `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	if req.Level < 1 || req.Level > 80 {
		Fail(c, http.StatusBadRequest, "bad_request", "level must be 1-80")
		return
	}
	cmd := fmt.Sprintf("character level %s %d", name, req.Level)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) characterRename(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
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
	cmd := "character rename " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

// characterSetName updates characters.name directly. Offline only.
func (s *Server) characterSetName(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	oldName, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		NewName string `json:"new_name"`
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
	newName, err := sanitizeCharName(req.NewName)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if strings.EqualFold(oldName, newName) {
		Fail(c, http.StatusBadRequest, "bad_request", "name unchanged")
		return
	}
	ctx := c.Request.Context()
	var online int
	err = rt.DB.Characters.QueryRowContext(ctx,
		`SELECT online FROM characters WHERE name = ? LIMIT 1`, oldName,
	).Scan(&online)
	if err != nil {
		Fail(c, http.StatusNotFound, "not_found", "character not found")
		return
	}
	if online != 0 {
		FailCode(c, http.StatusConflict, "character_online")
		return
	}
	var exists int
	_ = rt.DB.Characters.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM characters WHERE name = ?`, newName,
	).Scan(&exists)
	if exists > 0 {
		Fail(c, http.StatusConflict, "bad_request", "name already taken")
		return
	}
	res, err := rt.DB.Characters.ExecContext(ctx,
		`UPDATE characters SET name = ? WHERE name = ? AND online = 0`, newName, oldName,
	)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		FailCode(c, http.StatusConflict, "character_online")
		return
	}
	JSON(c, gin.H{"old_name": oldName, "new_name": newName, "updated": n})
}

func (s *Server) characterCustomize(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
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
	cmd := "character customize " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func sanitizeCharName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 16 {
		return "", fmt.Errorf("invalid character name")
	}
	for _, r := range name {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r)) {
			return "", fmt.Errorf("invalid character name characters")
		}
	}
	return name, nil
}

func quoteIdent(name string) string {
	name = strings.ReplaceAll(name, "`", "")
	return "`" + name + "`"
}
