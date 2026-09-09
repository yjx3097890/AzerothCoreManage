package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"acmanage/internal/gamelocale"
	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

func (s *Server) listGuilds(c *gin.Context) {
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
		where += " AND g.name LIKE ?"
		args = append(args, "%"+q+"%")
	}
	args = append(args, limit)
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT g.guildid, g.name, g.leaderguid, COALESCE(c.name,''), COALESCE(g.info,''), COALESCE(g.motd,''), g.createdate, g.BankMoney
FROM guild g
LEFT JOIN characters c ON c.guid = g.leaderguid
`+where+`
ORDER BY g.guildid
LIMIT ?`, args...)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, leader, bank uint32
		var name, leaderName, info, motd string
		var created int64
		if err := rows.Scan(&id, &name, &leader, &leaderName, &info, &motd, &created, &bank); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"id": id, "name": name, "leader_guid": leader, "leader_name": leaderName,
			"info": info, "motd": motd, "createdate": unixOrZero(created), "bank_money": bank,
		})
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) getGuild(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var guildID, leader, bank uint32
	var name, leaderName, info, motd string
	var created int64
	err = rt.DB.Characters.QueryRowContext(c.Request.Context(), `
SELECT g.guildid, g.name, g.leaderguid, COALESCE(c.name,''), COALESCE(g.info,''), COALESCE(g.motd,''), g.createdate, g.BankMoney
FROM guild g
LEFT JOIN characters c ON c.guid = g.leaderguid
WHERE g.guildid = ?`, id).Scan(&guildID, &name, &leader, &leaderName, &info, &motd, &created, &bank)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "guild not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT gm.guid, COALESCE(ch.name,''), gm.rank, COALESCE(gr.rname,'')
FROM guild_member gm
LEFT JOIN characters ch ON ch.guid = gm.guid
LEFT JOIN guild_rank gr ON gr.guildid = gm.guildid AND gr.rid = gm.rank
WHERE gm.guildid = ?
ORDER BY gm.rank, ch.name`, id)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	members := []gin.H{}
	for rows.Next() {
		var guid uint32
		var mname, rname string
		var rank uint8
		if err := rows.Scan(&guid, &mname, &rank, &rname); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		members = append(members, gin.H{"guid": guid, "name": mname, "rank": rank, "rank_name": rname})
	}
	JSON(c, gin.H{
		"id": guildID, "name": name, "leader_guid": leader, "leader_name": leaderName,
		"info": info, "motd": motd, "createdate": unixOrZero(created), "bank_money": bank,
		"members": members,
	})
}

func (s *Server) getGuildBank(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	ctx := c.Request.Context()
	worldDB := quoteIdent(rt.Cfg.MySQL.WorldDB)

	tabs := []gin.H{}
	if rows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT TabId, COALESCE(TabName,''), COALESCE(TabIcon,''), COALESCE(TabText,'')
FROM guild_bank_tab WHERE guildid = ? ORDER BY TabId`, id); err == nil {
		defer rows.Close()
		for rows.Next() {
			var tabID uint8
			var tabName, icon, text string
			if err := rows.Scan(&tabID, &tabName, &icon, &text); err != nil {
				break
			}
			tabs = append(tabs, gin.H{"tab": tabID, "name": tabName, "icon": icon, "text": text})
		}
	}

	items := []gin.H{}
	rows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT gbi.TabId, gbi.SlotId, gbi.item_guid, COALESCE(ii.itemEntry,0), COALESCE(ii.count,0), `+itemNameExpr("it", "itl")+`
FROM guild_bank_item gbi
LEFT JOIN item_instance ii ON ii.guid = gbi.item_guid
LEFT JOIN `+worldDB+`.item_template it ON it.entry = ii.itemEntry
`+itemLocaleJoin(worldDB, "it", "itl")+`
WHERE gbi.guildid = ?
ORDER BY gbi.TabId, gbi.SlotId`, id)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var tab, slot uint8
		var itemGUID, entry, count uint32
		var iname string
		if err := rows.Scan(&tab, &slot, &itemGUID, &entry, &count, &iname); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"tab": tab, "slot": slot, "item_guid": itemGUID,
			"item_entry": entry, "count": count, "name": iname,
		})
	}
	JSON(c, gin.H{"guild_id": id, "tabs": tabs, "items": items, "readonly": true})
}

func (s *Server) guildAction(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // create|delete|rename|rank|invite|uninvite
		Guild   string `json:"guild"`
		NewName string `json:"new_name"`
		Leader  string `json:"leader"`
		Player  string `json:"player"`
		Rank    *int   `json:"rank"`
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
	guild := sanitizeQuotedName(req.Guild, 24)
	var cmd string
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "create":
		leader, err := sanitizeCharName(req.Leader)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		if guild == "" {
			Fail(c, http.StatusBadRequest, "bad_request", "guild name required")
			return
		}
		cmd = fmt.Sprintf("guild create %s \"%s\"", leader, guild)
	case "delete", "disband":
		if guild == "" {
			Fail(c, http.StatusBadRequest, "bad_request", "guild name required")
			return
		}
		cmd = fmt.Sprintf("guild delete \"%s\"", guild)
	case "rename":
		newName := sanitizeQuotedName(req.NewName, 24)
		if guild == "" || newName == "" {
			Fail(c, http.StatusBadRequest, "bad_request", "guild and new_name required")
			return
		}
		cmd = fmt.Sprintf("guild rename \"%s\" \"%s\"", guild, newName)
	case "rank", "leader":
		player, err := sanitizeCharName(req.Player)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		rank := 0
		if req.Rank != nil {
			rank = *req.Rank
		}
		if rank < 0 || rank > 9 {
			Fail(c, http.StatusBadRequest, "bad_request", "rank 0-9 (0=master)")
			return
		}
		cmd = fmt.Sprintf("guild rank %s %d", player, rank)
	case "invite":
		player, err := sanitizeCharName(req.Player)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		if guild == "" {
			Fail(c, http.StatusBadRequest, "bad_request", "guild name required")
			return
		}
		cmd = fmt.Sprintf("guild invite %s \"%s\"", player, guild)
	case "uninvite":
		player, err := sanitizeCharName(req.Player)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		cmd = fmt.Sprintf("guild uninvite %s", player)
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

func sanitizeQuotedName(s string, max int) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\"", "")
	s = strings.ReplaceAll(s, "'", "")
	s = strings.ReplaceAll(s, "`", "")
	if max > 0 && len(s) > max {
		s = s[:max]
	}
	return s
}

func (s *Server) listAuctions(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	worldDB := quoteIdent(rt.Cfg.MySQL.WorldDB)
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT a.id, a.houseid, a.itemguid, COALESCE(ii.itemEntry,0), a.itemowner, COALESCE(c.name,''),
       a.buyoutprice, a.startbid, a.lastbid, a.buyguid, a.deposit, a.time,
       `+itemNameExpr("it", "itl")+`, COALESCE(ii.count,1)
FROM auctionhouse a
LEFT JOIN characters c ON c.guid = a.itemowner
LEFT JOIN item_instance ii ON ii.guid = a.itemguid
LEFT JOIN `+worldDB+`.item_template it ON it.entry = ii.itemEntry
`+itemLocaleJoin(worldDB, "it", "itl")+`
ORDER BY a.id DESC
LIMIT ?`, limit)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, house, itemGUID, entry, owner, buyout, startBid, bid, buyGUID, deposit uint32
		var expire int64
		var ownerName, itemName string
		var count uint32
		if err := rows.Scan(&id, &house, &itemGUID, &entry, &owner, &ownerName, &buyout, &startBid, &bid, &buyGUID, &deposit, &expire, &itemName, &count); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"id": id, "house": house, "item_guid": itemGUID, "item_entry": entry,
			"owner_guid": owner, "owner_name": ownerName, "buyout": buyout, "start_bid": startBid,
			"bid": bid, "buy_guid": buyGUID, "deposit": deposit, "expire": unixOrZero(expire),
			"item_name": itemName, "count": count,
		})
	}
	JSON(c, gin.H{"items": items, "readonly": true})
}

func (s *Server) listEvents(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	result, err := s.execSOAP(c, rt, "event activelist")
	if err != nil {
		return
	}
	loc := i18n.FromRequest(c)
	items := gamelocale.ParseActiveList(result, loc)
	JSON(c, gin.H{"items": items, "raw": result})
}

func (s *Server) eventAction(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"`
		EventID int    `json:"event_id"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm || req.EventID <= 0 {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm and event_id required")
		return
	}
	var cmd string
	switch strings.ToLower(req.Action) {
	case "start":
		cmd = fmt.Sprintf("event start %d", req.EventID)
	case "stop":
		cmd = fmt.Sprintf("event stop %d", req.EventID)
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

func (s *Server) reloadTables(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Table   string `json:"table"`
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
	allowed := map[string]bool{
		"config": true, "loot": true, "quest": true, "creature": true, "motd": true,
		"all": true, "spell": true, "item": true, "gossip": true, "tele": true,
		"disables": true, "chat_filter": true, "reserved_name": true, "profanity_name": true,
		"autobroadcast": true,
	}
	table := strings.ToLower(strings.TrimSpace(req.Table))
	if !allowed[table] {
		Fail(c, http.StatusBadRequest, "bad_request", "table not in allow-list")
		return
	}
	cmd := "reload " + table
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) soapExec(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Command string `json:"command"`
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
	cmd := strings.TrimSpace(req.Command)
	if cmd == "" {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) listAutobroadcast(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	rows, err := rt.DB.Auth.QueryContext(c.Request.Context(), `
SELECT id, COALESCE(text,''), weight
FROM autobroadcast
ORDER BY id`)
	if err != nil {
		rows2, err2 := rt.DB.World.QueryContext(c.Request.Context(), `
SELECT id, COALESCE(text,''), weight
FROM autobroadcast
ORDER BY id`)
		if err2 != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error()+"; "+err2.Error())
			return
		}
		defer rows2.Close()
		items := []gin.H{}
		for rows2.Next() {
			var id, weight uint32
			var text string
			if err := rows2.Scan(&id, &text, &weight); err != nil {
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{"id": id, "text": text, "weight": weight})
		}
		JSON(c, gin.H{"items": items, "source": "world"})
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var id, weight uint32
		var text string
		if err := rows.Scan(&id, &text, &weight); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{"id": id, "text": text, "weight": weight})
	}
	JSON(c, gin.H{"items": items, "source": "auth"})
}
