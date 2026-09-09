package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"acmanage/internal/audit"

	"github.com/gin-gonic/gin"
)

type mailItemSpec struct {
	ItemID int `json:"item_id"`
	Count  int `json:"count"`
}

type mailSendPayload struct {
	Mode    string         `json:"mode"` // mail | items | money | auto (infer)
	Player  string         `json:"player"`
	Players []string       `json:"players"`
	Subject string         `json:"subject"`
	Body    string         `json:"body"`
	ItemID  int            `json:"item_id"`
	Count   int            `json:"count"`
	Items   []mailItemSpec `json:"items"`
	Money   string         `json:"money"` // 1g2s3c
	Confirm bool           `json:"confirm"`
	DelayMS int            `json:"delay_ms"`
}

func (s *Server) sendMail(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req mailSendPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	player, err := sanitizeCharName(req.Player)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	cmds, err := buildMailCommands(player, req)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	results := []gin.H{}
	for _, cmd := range cmds {
		result, err := s.execSOAP(c, rt, cmd)
		if err != nil {
			return
		}
		results = append(results, gin.H{"command": cmd, "result": result})
	}
	JSON(c, gin.H{"commands": results, "command": cmds[0], "result": results[0]["result"]})
}

func (s *Server) sendMailBulk(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req mailSendPayload
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	players := uniquePlayers(req.Players)
	if len(players) == 0 && strings.TrimSpace(req.Player) != "" {
		if p, err := sanitizeCharName(req.Player); err == nil {
			players = []string{p}
		}
	}
	if len(players) == 0 {
		Fail(c, http.StatusBadRequest, "bad_request", "players required")
		return
	}
	if len(players) > 50 {
		Fail(c, http.StatusBadRequest, "bad_request", "max 50 players per bulk send")
		return
	}
	delay := time.Duration(req.DelayMS) * time.Millisecond
	if delay <= 0 {
		delay = 150 * time.Millisecond
	}
	if delay > 2*time.Second {
		delay = 2 * time.Second
	}

	okCount := 0
	items := []gin.H{}
	for i, player := range players {
		if i > 0 {
			time.Sleep(delay)
		}
		cmds, err := buildMailCommands(player, req)
		if err != nil {
			items = append(items, gin.H{"player": player, "ok": false, "error": err.Error()})
			continue
		}
		playerOK := true
		cmdResults := []gin.H{}
		for _, cmd := range cmds {
			result, err := s.runSOAP(c, rt, cmd)
			if err != nil {
				playerOK = false
				cmdResults = append(cmdResults, gin.H{"command": cmd, "ok": false, "error": err.Error()})
				break
			}
			cmdResults = append(cmdResults, gin.H{"command": cmd, "ok": true, "result": result})
		}
		if playerOK {
			okCount++
		}
		items = append(items, gin.H{"player": player, "ok": playerOK, "commands": cmdResults})
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "mail.bulk", Detail: fmt.Sprintf("players=%d ok=%d", len(players), okCount), OK: okCount == len(players),
	})
	JSON(c, gin.H{"total": len(players), "ok": okCount, "items": items})
}

func (s *Server) listMails(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	player, err := sanitizeCharName(c.Query("player"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", "player query required")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	ctx := c.Request.Context()
	var guid uint32
	var online int
	err = rt.DB.Characters.QueryRowContext(ctx,
		`SELECT guid, online FROM characters WHERE name = ? LIMIT 1`, player,
	).Scan(&guid, &online)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "character not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}

	worldDB := quoteIdent(rt.Cfg.MySQL.WorldDB)
	rows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT m.id, m.messageType, m.stationery, m.sender, COALESCE(cs.name,''), m.receiver,
       COALESCE(m.subject,''), COALESCE(m.body,''), m.has_items, m.expire_time, m.deliver_time,
       m.money, m.cod, m.checked
FROM mail m
LEFT JOIN characters cs ON cs.guid = m.sender AND m.messageType = 0
WHERE m.receiver = ?
ORDER BY m.id DESC
LIMIT ?`, guid, limit)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	mails := []gin.H{}
	mailIDs := []uint32{}
	for rows.Next() {
		var id, sender, receiver, money, cod uint32
		var msgType, stationery, hasItems, checked uint8
		var senderName, subject, body string
		var expire, deliver int64
		if err := rows.Scan(&id, &msgType, &stationery, &sender, &senderName, &receiver,
			&subject, &body, &hasItems, &expire, &deliver, &money, &cod, &checked); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		mailIDs = append(mailIDs, id)
		mails = append(mails, gin.H{
			"id": id, "message_type": msgType, "stationery": stationery,
			"sender": sender, "sender_name": senderName, "receiver": receiver, "receiver_name": player,
			"subject": subject, "body": body, "has_items": hasItems == 1,
			"expire_time": unixOrZero(expire), "deliver_time": unixOrZero(deliver),
			"money": money, "cod": cod, "checked": checked, "items": []gin.H{},
		})
	}

	itemMap := map[uint32][]gin.H{}
	if len(mailIDs) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(mailIDs)), ",")
		args := make([]any, len(mailIDs))
		for i, id := range mailIDs {
			args[i] = id
		}
		itemRows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT mi.mail_id, mi.item_guid, COALESCE(ii.itemEntry,0), COALESCE(ii.count,0), `+itemNameExpr("it", "itl")+`
FROM mail_items mi
LEFT JOIN item_instance ii ON ii.guid = mi.item_guid
LEFT JOIN `+worldDB+`.item_template it ON it.entry = ii.itemEntry
`+itemLocaleJoin(worldDB, "it", "itl")+`
WHERE mi.mail_id IN (`+placeholders+`)`, args...)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		defer itemRows.Close()
		for itemRows.Next() {
			var mailID, itemGUID, entry, count uint32
			var name string
			if err := itemRows.Scan(&mailID, &itemGUID, &entry, &count, &name); err != nil {
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			itemMap[mailID] = append(itemMap[mailID], gin.H{
				"item_guid": itemGUID, "item_entry": entry, "count": count, "name": name,
			})
		}
		for i := range mails {
			id := mailIDs[i]
			if its, ok := itemMap[id]; ok {
				mails[i]["items"] = its
			}
		}
	}

	JSON(c, gin.H{
		"player": player, "guid": guid, "online": online,
		"items": mails,
		"note":  "delete only allowed while character is offline",
	})
}

func (s *Server) deleteMail(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	mailID, err := strconv.Atoi(c.Param("id"))
	if err != nil || mailID <= 0 {
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

	ctx := c.Request.Context()
	var receiver uint32
	var receiverName string
	var online int
	var hasItems uint8
	err = rt.DB.Characters.QueryRowContext(ctx, `
SELECT m.receiver, COALESCE(c.name,''), c.online, m.has_items
FROM mail m
JOIN characters c ON c.guid = m.receiver
WHERE m.id = ?`, mailID).Scan(&receiver, &receiverName, &online, &hasItems)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "mail not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	if online != 0 {
		Fail(c, http.StatusConflict, "character_online", "refuse delete while receiver is online")
		return
	}

	tx, err := rt.DB.Characters.BeginTx(ctx, nil)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer func() { _ = tx.Rollback() }()

	if hasItems == 1 {
		itemRows, err := tx.QueryContext(ctx, `SELECT item_guid FROM mail_items WHERE mail_id = ?`, mailID)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		var guids []uint32
		for itemRows.Next() {
			var g uint32
			if err := itemRows.Scan(&g); err != nil {
				itemRows.Close()
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			guids = append(guids, g)
		}
		itemRows.Close()
		if _, err := tx.ExecContext(ctx, `DELETE FROM mail_items WHERE mail_id = ?`, mailID); err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		for _, g := range guids {
			if _, err := tx.ExecContext(ctx, `DELETE FROM item_instance WHERE guid = ?`, g); err != nil {
				Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
				return
			}
		}
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM mail WHERE id = ?`, mailID)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		Fail(c, http.StatusNotFound, "not_found", "mail not found")
		return
	}
	if err := tx.Commit(); err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	_ = s.app.Audit.Write(ctx, audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "mail.delete", Detail: fmt.Sprintf("id=%d receiver=%s", mailID, receiverName), OK: true,
	})
	JSON(c, gin.H{"deleted": mailID, "receiver": receiverName})
}

func buildMailCommands(player string, req mailSendPayload) ([]string, error) {
	subject := sanitizeMailText(req.Subject, 64)
	body := sanitizeMailText(req.Body, 500)
	if subject == "" {
		subject = "GM"
	}

	items := normalizeMailItems(req)
	money := strings.TrimSpace(req.Money)
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" || mode == "auto" {
		switch {
		case len(items) > 0 && money != "":
			mode = "both"
		case len(items) > 0:
			mode = "items"
		case money != "":
			mode = "money"
		default:
			mode = "mail"
		}
	}

	switch mode {
	case "mail":
		return []string{fmt.Sprintf("send mail %s \"%s\" \"%s\"", player, subject, body)}, nil
	case "items":
		if len(items) == 0 {
			return nil, fmt.Errorf("item_id / items required")
		}
		return []string{fmt.Sprintf("send items %s \"%s\" \"%s\" %s", player, subject, body, formatItemTail(items))}, nil
	case "money":
		m, err := normalizeMoney(money)
		if err != nil {
			return nil, err
		}
		return []string{fmt.Sprintf("send money %s \"%s\" \"%s\" %s", player, subject, body, m)}, nil
	case "both":
		if len(items) == 0 {
			return nil, fmt.Errorf("items required for both mode")
		}
		m, err := normalizeMoney(money)
		if err != nil {
			return nil, err
		}
		return []string{
			fmt.Sprintf("send items %s \"%s\" \"%s\" %s", player, subject, body, formatItemTail(items)),
			fmt.Sprintf("send money %s \"%s\" \"%s\" %s", player, subject, body, m),
		}, nil
	default:
		return nil, fmt.Errorf("invalid mode")
	}
}

func normalizeMailItems(req mailSendPayload) []mailItemSpec {
	out := []mailItemSpec{}
	for _, it := range req.Items {
		if it.ItemID <= 0 {
			continue
		}
		count := it.Count
		if count <= 0 {
			count = 1
		}
		if count > 1000 {
			count = 1000
		}
		out = append(out, mailItemSpec{ItemID: it.ItemID, Count: count})
	}
	if len(out) == 0 && req.ItemID > 0 {
		count := req.Count
		if count <= 0 {
			count = 1
		}
		if count > 1000 {
			count = 1000
		}
		out = append(out, mailItemSpec{ItemID: req.ItemID, Count: count})
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

func formatItemTail(items []mailItemSpec) string {
	parts := make([]string, 0, len(items))
	for _, it := range items {
		parts = append(parts, fmt.Sprintf("%d:%d", it.ItemID, it.Count))
	}
	return strings.Join(parts, " ")
}

func uniquePlayers(names []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, raw := range names {
		p, err := sanitizeCharName(raw)
		if err != nil {
			continue
		}
		key := strings.ToLower(p)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, p)
	}
	return out
}
