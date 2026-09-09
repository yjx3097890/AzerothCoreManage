package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"acmanage/internal/app"

	"github.com/gin-gonic/gin"
)

type accountRow struct {
	ID         uint32     `json:"id"`
	Username   string     `json:"username"`
	Email      string     `json:"email"`
	LastIP     string     `json:"last_ip"`
	LastLogin  *time.Time `json:"last_login"`
	Online     int        `json:"online"`
	Locked     int        `json:"locked"`
	Expansion  int        `json:"expansion"`
	GMLevel    int        `json:"gmlevel"`
	JoinDate   *time.Time `json:"joindate"`
}

func (s *Server) requireTargetDB(c *gin.Context) (*app.TargetRuntime, bool) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return nil, false
	}
	if err := s.app.EnsureMySQL(rt); err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return nil, false
	}
	if rt.DB == nil || rt.DB.Auth == nil {
		Fail(c, http.StatusServiceUnavailable, "mysql_unavailable", "mysql not ready")
		return nil, false
	}
	return rt, true
}

func (s *Server) listAccounts(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	ctx := c.Request.Context()
	args := []any{}
	where := "WHERE 1=1"
	if q != "" {
		where += " AND (a.username LIKE ? OR CAST(a.id AS CHAR) = ?)"
		like := "%" + q + "%"
		args = append(args, like, q)
	}

	countQ := `SELECT COUNT(*) FROM account a ` + where
	var total int
	if err := rt.DB.Auth.QueryRowContext(ctx, countQ, args...).Scan(&total); err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}

	listQ := `
SELECT a.id, a.username, COALESCE(a.email,''), COALESCE(a.last_ip,''), a.last_login,
       a.online, a.locked, a.expansion, a.joindate,
       COALESCE((SELECT MAX(aa.gmlevel) FROM account_access aa WHERE aa.id = a.id), 0) AS gmlevel
FROM account a
` + where + `
ORDER BY a.id DESC
LIMIT ? OFFSET ?`
	args = append(args, limit, offset)
	rows, err := rt.DB.Auth.QueryContext(ctx, listQ, args...)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	items := make([]accountRow, 0)
	for rows.Next() {
		var item accountRow
		var lastLogin, joinDate sql.NullTime
		if err := rows.Scan(
			&item.ID, &item.Username, &item.Email, &item.LastIP, &lastLogin,
			&item.Online, &item.Locked, &item.Expansion, &joinDate, &item.GMLevel,
		); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		if lastLogin.Valid {
			t := lastLogin.Time
			item.LastLogin = &t
		}
		if joinDate.Valid {
			t := joinDate.Time
			item.JoinDate = &t
		}
		items = append(items, item)
	}
	JSON(c, gin.H{"items": items, "total": total, "limit": limit, "offset": offset})
}

func (s *Server) createAccount(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	user, err := sanitizeAccountName(req.Username)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	pass := strings.TrimSpace(req.Password)
	if len(pass) < 4 || len(pass) > 32 {
		Fail(c, http.StatusBadRequest, "bad_request", "password length 4-32")
		return
	}
	cmd := fmt.Sprintf("account create %s %s", user, pass)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) setAccountPassword(c *gin.Context) {
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
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	pass := strings.TrimSpace(req.Password)
	if len(pass) < 4 || len(pass) > 32 {
		Fail(c, http.StatusBadRequest, "bad_request", "password length 4-32")
		return
	}
	cmd := fmt.Sprintf("account set password %s %s %s", user, pass, pass)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) setAccountGMLevel(c *gin.Context) {
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
		Level   int  `json:"level"`
		Realm   int  `json:"realm"`
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
	if req.Level < 0 || req.Level > 3 {
		Fail(c, http.StatusBadRequest, "bad_request", "gmlevel must be 0-3")
		return
	}
	cmd := fmt.Sprintf("account set gmlevel %s %d %d", user, req.Level, req.Realm)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func sanitizeAccountName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 32 {
		return "", fmt.Errorf("invalid account name")
	}
	for _, r := range name {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-') {
			return "", fmt.Errorf("invalid account name characters")
		}
	}
	return name, nil
}
