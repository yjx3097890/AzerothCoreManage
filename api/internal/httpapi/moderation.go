package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

func (s *Server) listBans(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	kind := strings.ToLower(strings.TrimSpace(c.DefaultQuery("type", "all")))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 300 {
		limit = 100
	}

	out := gin.H{}

	if kind == "all" || kind == "account" {
		rows, err := rt.DB.Auth.QueryContext(ctx, `
SELECT ab.id, COALESCE(a.username,''), ab.bandate, ab.unbandate, ab.bannedby, ab.banreason, ab.active
FROM account_banned ab
LEFT JOIN account a ON a.id = ab.id
WHERE ab.active = 1
ORDER BY ab.bandate DESC
LIMIT ?`, limit)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		items := []gin.H{}
		for rows.Next() {
			var id uint32
			var username, by, reason string
			var bandate, unbandate int64
			var active int
			if err := rows.Scan(&id, &username, &bandate, &unbandate, &by, &reason, &active); err != nil {
				rows.Close()
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{
				"id": id, "account_id": id, "username": username,
				"bandate": unixOrZero(bandate), "unbandate": unixOrZero(unbandate),
				"bannedby": by, "reason": reason, "active": active, "type": "account",
			})
		}
		rows.Close()
		out["account"] = items
	}

	if kind == "all" || kind == "ip" {
		rows, err := rt.DB.Auth.QueryContext(ctx, `
SELECT ip, bandate, unbandate, bannedby, banreason
FROM ip_banned
ORDER BY bandate DESC
LIMIT ?`, limit)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		items := []gin.H{}
		for rows.Next() {
			var ip, by, reason string
			var bandate, unbandate int64
			if err := rows.Scan(&ip, &bandate, &unbandate, &by, &reason); err != nil {
				rows.Close()
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{
				"ip": ip, "bandate": unixOrZero(bandate), "unbandate": unixOrZero(unbandate),
				"bannedby": by, "reason": reason, "type": "ip",
			})
		}
		rows.Close()
		out["ip"] = items
	}

	if kind == "all" || kind == "character" {
		rows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT cb.guid, COALESCE(c.name,''), cb.bandate, cb.unbandate, cb.bannedby, cb.banreason, cb.active
FROM character_banned cb
LEFT JOIN characters c ON c.guid = cb.guid
WHERE cb.active = 1
ORDER BY cb.bandate DESC
LIMIT ?`, limit)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		items := []gin.H{}
		for rows.Next() {
			var guid uint32
			var name, by, reason string
			var bandate, unbandate int64
			var active int
			if err := rows.Scan(&guid, &name, &bandate, &unbandate, &by, &reason, &active); err != nil {
				rows.Close()
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{
				"guid": guid, "name": name,
				"bandate": unixOrZero(bandate), "unbandate": unixOrZero(unbandate),
				"bannedby": by, "reason": reason, "active": active, "type": "character",
			})
		}
		rows.Close()
		out["character"] = items
	}

	JSON(c, out)
}

func unixOrZero(sec int64) any {
	if sec <= 0 {
		return nil
	}
	return time.Unix(sec, 0).UTC()
}

func (s *Server) moderationBan(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Type     string `json:"type"` // account | character | ip | playeraccount
		Target   string `json:"target"`
		Duration string `json:"duration"` // e.g. 1d / -1 permanent
		Reason   string `json:"reason"`
		Confirm  bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	target := strings.TrimSpace(req.Target)
	if target == "" || strings.ContainsAny(target, " \t\n\"'`") {
		Fail(c, http.StatusBadRequest, "bad_request", "invalid target")
		return
	}
	duration := strings.TrimSpace(req.Duration)
	if duration == "" {
		duration = "-1"
	}
	reason := sanitizeReason(req.Reason)
	var cmd string
	switch strings.ToLower(req.Type) {
	case "account":
		cmd = fmt.Sprintf("ban account %s %s %s", target, duration, reason)
	case "character", "player":
		cmd = fmt.Sprintf("ban character %s %s %s", target, duration, reason)
	case "ip":
		cmd = fmt.Sprintf("ban ip %s %s %s", target, duration, reason)
	case "playeraccount":
		cmd = fmt.Sprintf("ban playeraccount %s %s %s", target, duration, reason)
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

func (s *Server) moderationUnban(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Type    string `json:"type"`
		Target  string `json:"target"`
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
	target := strings.TrimSpace(req.Target)
	if target == "" || strings.ContainsAny(target, " \t\n\"'`") {
		Fail(c, http.StatusBadRequest, "bad_request", "invalid target")
		return
	}
	var cmd string
	switch strings.ToLower(req.Type) {
	case "account":
		cmd = "unban account " + target
	case "character", "player":
		cmd = "unban character " + target
	case "ip":
		cmd = "unban ip " + target
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

func (s *Server) moderationMute(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Name     string `json:"name"`
		Duration string `json:"duration"`
		Reason   string `json:"reason"`
		Confirm  bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	name, err := sanitizeCharName(req.Name)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	duration := strings.TrimSpace(req.Duration)
	if duration == "" {
		duration = "1h"
	}
	cmd := fmt.Sprintf("mute %s %s %s", name, duration, sanitizeReason(req.Reason))
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) moderationUnmute(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Name    string `json:"name"`
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
	name, err := sanitizeCharName(req.Name)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	cmd := "unmute " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func sanitizeReason(reason string) string {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return "panel"
	}
	reason = strings.ReplaceAll(reason, "\n", " ")
	reason = strings.ReplaceAll(reason, "\r", " ")
	if len(reason) > 128 {
		reason = reason[:128]
	}
	return reason
}
