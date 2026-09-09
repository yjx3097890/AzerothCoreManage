package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (s *Server) account2FA(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	user, err := sanitizeAccountName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	ctx := c.Request.Context()
	var id uint32
	var secret sql.NullString
	err = rt.DB.Auth.QueryRowContext(ctx,
		`SELECT id, CAST(totp_secret AS CHAR) FROM account WHERE username = ? LIMIT 1`, user,
	).Scan(&id, &secret)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "account not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	enabled := secret.Valid && strings.TrimSpace(secret.String) != ""
	JSON(c, gin.H{"account": user, "id": id, "enabled": enabled})
}

func (s *Server) accountDisable2FA(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	user, err := sanitizeAccountName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Confirm bool   `json:"confirm"`
		Phrase  string `json:"phrase"`
	}
	_ = c.ShouldBindJSON(&req)
	if !req.Confirm || req.Phrase != user {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm with matching username phrase")
		return
	}
	cmd := fmt.Sprintf("account set 2fa %s off", user)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) listLoginLogs(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	account := strings.TrimSpace(c.Query("account"))
	ip := strings.TrimSpace(c.Query("ip"))

	failed := []gin.H{}
	{
		where := "WHERE failed_logins > 0"
		args := []any{}
		if account != "" {
			where += " AND username LIKE ?"
			args = append(args, "%"+account+"%")
		}
		if ip != "" {
			where += " AND (last_attempt_ip LIKE ? OR last_ip LIKE ?)"
			args = append(args, ip+"%", ip+"%")
		}
		args = append(args, limit)
		rows, err := rt.DB.Auth.QueryContext(c.Request.Context(), `
SELECT id, username, COALESCE(last_ip,''), COALESCE(last_attempt_ip,''), failed_logins, last_login
FROM account
`+where+`
ORDER BY failed_logins DESC, id DESC
LIMIT ?`, args...)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, fails uint32
				var user, lastIP, attemptIP string
				var lastLogin sql.NullTime
				if err := rows.Scan(&id, &user, &lastIP, &attemptIP, &fails, &lastLogin); err != nil {
					break
				}
				item := gin.H{
					"id": id, "username": user, "last_ip": lastIP, "last_attempt_ip": attemptIP,
					"failed_logins": fails,
				}
				if lastLogin.Valid {
					item["last_login"] = lastLogin.Time
				}
				failed = append(failed, item)
			}
		}
	}

	actions := []gin.H{}
	{
		where := "WHERE 1=1"
		args := []any{}
		if account != "" {
			where += " AND account_id IN (SELECT id FROM account WHERE username LIKE ?)"
			args = append(args, "%"+account+"%")
		}
		if ip != "" {
			where += " AND ip LIKE ?"
			args = append(args, ip+"%")
		}
		args = append(args, limit)
		rows, err := rt.DB.Auth.QueryContext(c.Request.Context(), `
SELECT id, account_id, character_guid, type, COALESCE(ip,''), COALESCE(systemnote,''), unixtime, COALESCE(comment,'')
FROM logs_ip_actions
`+where+`
ORDER BY id DESC
LIMIT ?`, args...)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id, accountID, charGUID, typ, unixtime uint32
				var ipAddr, note, comment string
				if err := rows.Scan(&id, &accountID, &charGUID, &typ, &ipAddr, &note, &unixtime, &comment); err != nil {
					break
				}
				actions = append(actions, gin.H{
					"id": id, "account_id": accountID, "character_guid": charGUID, "type": typ,
					"ip": ipAddr, "systemnote": note, "unixtime": unixOrZero(int64(unixtime)), "comment": comment,
				})
			}
		}
	}

	JSON(c, gin.H{"failed_logins": failed, "ip_actions": actions})
}

func (s *Server) listNameFilters(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	kind := strings.ToLower(strings.TrimSpace(c.DefaultQuery("kind", "chat_filter")))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	ctx := c.Request.Context()
	items := []gin.H{}
	switch kind {
	case "chat_filter":
		rows, err := rt.DB.Characters.QueryContext(ctx, `SELECT ID, COALESCE(Word,'') FROM chat_filter ORDER BY ID LIMIT ?`, limit)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		defer rows.Close()
		for rows.Next() {
			var id uint32
			var word string
			if err := rows.Scan(&id, &word); err != nil {
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{"id": id, "word": word})
		}
	case "reserved_name", "profanity_name":
		q := fmt.Sprintf(`SELECT name FROM %s ORDER BY name LIMIT ?`, kind)
		rows, err := rt.DB.Characters.QueryContext(ctx, q, limit)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{"name": name})
		}
	default:
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	JSON(c, gin.H{"kind": kind, "items": items})
}

func (s *Server) mutateNameFilter(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	var req struct {
		Kind    string `json:"kind"` // chat_filter | reserved_name | profanity_name
		Action  string `json:"action"` // add | remove
		Value   string `json:"value"`
		Confirm bool   `json:"confirm"`
		Reload  bool   `json:"reload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	value := strings.TrimSpace(req.Value)
	if value == "" || len(value) > 64 || strings.ContainsAny(value, "\"'`\\;") {
		Fail(c, http.StatusBadRequest, "bad_request", "invalid value")
		return
	}
	kind := strings.ToLower(strings.TrimSpace(req.Kind))
	action := strings.ToLower(strings.TrimSpace(req.Action))
	ctx := c.Request.Context()
	var err error
	switch kind {
	case "chat_filter":
		switch action {
		case "add":
			_, err = rt.DB.Characters.ExecContext(ctx, `INSERT INTO chat_filter (Word) VALUES (?)`, value)
		case "remove":
			_, err = rt.DB.Characters.ExecContext(ctx, `DELETE FROM chat_filter WHERE Word = ? OR ID = ?`, value, atoiSafe(value))
		default:
			FailCode(c, http.StatusBadRequest, "bad_request")
			return
		}
	case "reserved_name", "profanity_name":
		table := kind
		switch action {
		case "add":
			_, err = rt.DB.Characters.ExecContext(ctx, fmt.Sprintf(`INSERT IGNORE INTO %s (name) VALUES (?)`, table), value)
		case "remove":
			_, err = rt.DB.Characters.ExecContext(ctx, fmt.Sprintf(`DELETE FROM %s WHERE name = ?`, table), value)
		default:
			FailCode(c, http.StatusBadRequest, "bad_request")
			return
		}
	default:
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	out := gin.H{"kind": kind, "action": action, "value": value}
	if req.Reload {
		reloadMap := map[string]string{
			"chat_filter": "chat_filter", "reserved_name": "reserved_name", "profanity_name": "profanity_name",
		}
		cmd := "reload " + reloadMap[kind]
		if result, err := s.runSOAP(c, rt, cmd); err == nil {
			out["reload"] = result
		} else {
			out["reload_error"] = err.Error()
		}
	}
	JSON(c, out)
}

func atoiSafe(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}
