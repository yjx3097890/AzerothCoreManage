package httpapi

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"acmanage/internal/audit"
	"acmanage/internal/config"
	"acmanage/internal/modules"

	"github.com/gin-gonic/gin"
)

var confLineRe = regexp.MustCompile(`^(\s*)([A-Za-z0-9_.]+)(\s*=\s*)(.*?)(\s*(?:#.*)?)?$`)

func (s *Server) listConfigFiles(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	files := []gin.H{}
	for _, item := range confFileSpecs(rt.Cfg.Conf) {
		st, err := os.Stat(item.path)
		entry := gin.H{"id": item.id, "path": item.path, "available": err == nil}
		if err == nil {
			entry["size"] = st.Size()
			entry["mod_time"] = st.ModTime()
		} else {
			entry["error"] = err.Error()
		}
		files = append(files, entry)
	}
	// P2-A: etc/modules/*.conf
	etcMods := rt.Cfg.Modules.EtcModulesDir
	if etcMods == "" && rt.Cfg.Conf.EtcDir != "" {
		etcMods = filepath.Join(rt.Cfg.Conf.EtcDir, "modules")
	}
	for _, mc := range modules.ListEtcModuleConfs(etcMods) {
		entry := gin.H{"id": mc.ID, "path": mc.Path, "available": mc.Available, "size": mc.Size, "group": "modules"}
		files = append(files, entry)
	}
	JSON(c, gin.H{"items": files})
}

func (s *Server) createBackup(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
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
	dir := rt.Cfg.Backup.Dir
	if dir == "" {
		dir = filepath.Join("..", "data", "backups")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		Fail(c, http.StatusBadGateway, "backup_error", err.Error())
		return
	}
	dump := rt.Cfg.Backup.MysqldumpPath
	if dump == "" {
		dump = "mysqldump"
	}
	stamp := time.Now().Format("20060102-150405")
	dbs := []struct {
		name string
		db   string
	}{
		{"auth", rt.Cfg.MySQL.AuthDB},
		{"characters", rt.Cfg.MySQL.CharactersDB},
		{"world", rt.Cfg.MySQL.WorldDB},
		{"playerbots", rt.Cfg.MySQL.PlayerbotsDB},
	}
	files := []gin.H{}
	for _, d := range dbs {
		if d.db == "" {
			continue
		}
		outPath := filepath.Join(dir, fmt.Sprintf("%s-%s-%s.sql", stamp, rt.Cfg.ID, d.name))
		args := []string{
			"-h", rt.Cfg.MySQL.Host,
			"-P", fmt.Sprintf("%d", rt.Cfg.MySQL.Port),
			"-u", rt.Cfg.MySQL.User,
			"--single-transaction",
			"--routines",
			"--triggers",
			d.db,
		}
		cmd := exec.CommandContext(c.Request.Context(), dump, args...)
		cmd.Env = append(os.Environ(), "MYSQL_PWD="+rt.Cfg.MySQL.Password)
		f, err := os.Create(outPath)
		if err != nil {
			Fail(c, http.StatusBadGateway, "backup_error", err.Error())
			return
		}
		cmd.Stdout = f
		cmd.Stderr = f
		runErr := cmd.Run()
		_ = f.Close()
		entry := gin.H{"db": d.name, "file": outPath, "ok": runErr == nil}
		if runErr != nil {
			entry["error"] = runErr.Error()
		}
		files = append(files, entry)
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "backup.mysqldump", Detail: dir, OK: true,
	})
	JSON(c, gin.H{"dir": dir, "files": files})
}

var sqlBrowserAllow = map[string]map[string]bool{
	"auth": {
		"account": true, "account_access": true, "account_banned": true, "ip_banned": true,
		"autobroadcast": true, "logs_ip_actions": true, "logs": true, "realmlist": true,
	},
	"characters": {
		"characters": true, "character_inventory": true, "character_queststatus": true,
		"character_reputation": true, "character_achievement": true, "character_pet": true,
		"mail": true, "mail_items": true, "guild": true, "guild_member": true, "guild_bank_item": true,
		"arena_team": true, "arena_team_member": true, "groups": true, "group_member": true,
		"gm_ticket": true, "chat_filter": true, "reserved_name": true, "profanity_name": true,
		"auctionhouse": true, "item_instance": true,
	},
	"world": {
		"item_template": true, "creature_template": true, "quest_template": true,
		"game_tele": true, "disables": true, "command": true,
	},
	"playerbots": {},
}

func (s *Server) sqlBrowser(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	dbName := strings.ToLower(strings.TrimSpace(c.DefaultQuery("db", "characters")))
	table := strings.TrimSpace(c.Query("table"))
	limit := 50
	if v := strings.TrimSpace(c.Query("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	allow, ok := sqlBrowserAllow[dbName]
	if !ok {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var db = rt.DB.Characters
	switch dbName {
	case "auth":
		db = rt.DB.Auth
	case "world":
		db = rt.DB.World
	case "playerbots":
		if rt.DB.Playerbots == nil {
			Fail(c, http.StatusBadRequest, "mysql_unavailable", "playerbots db unavailable")
			return
		}
		db = rt.DB.Playerbots
	}
	if table == "" {
		names := []string{}
		for name := range allow {
			names = append(names, name)
		}
		JSON(c, gin.H{"db": dbName, "tables": names})
		return
	}
	if !allow[table] || !isSafeIdent(table) {
		Fail(c, http.StatusForbidden, "forbidden", "table not in allow-list")
		return
	}
	q := fmt.Sprintf("SELECT * FROM `%s` LIMIT %d", table, limit)
	rows, err := db.QueryContext(c.Request.Context(), q)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
		return
	}
	items := []gin.H{}
	for rows.Next() {
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		row := gin.H{}
		for i, col := range cols {
			row[col] = stringifySQL(raw[i])
		}
		items = append(items, row)
	}
	JSON(c, gin.H{"db": dbName, "table": table, "columns": cols, "items": items, "readonly": true})
}

func (s *Server) upsertAutobroadcast(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	var req struct {
		ID      *int   `json:"id"`
		Text    string `json:"text"`
		Weight  int    `json:"weight"`
		Realmid int    `json:"realmid"`
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
	text := strings.TrimSpace(req.Text)
	if text == "" || len(text) > 2000 {
		Fail(c, http.StatusBadRequest, "bad_request", "text required")
		return
	}
	if req.Weight <= 0 {
		req.Weight = 1
	}
	ctx := c.Request.Context()
	db := rt.DB.Auth
	source := "auth"
	if req.ID != nil && *req.ID > 0 {
		res, err := db.ExecContext(ctx, `UPDATE autobroadcast SET text=?, weight=? WHERE id=?`, text, req.Weight, *req.ID)
		if err != nil {
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			Fail(c, http.StatusNotFound, "not_found", "autobroadcast not found")
			return
		}
		JSON(c, gin.H{"id": *req.ID, "updated": true, "source": source})
		return
	}
	res, err := db.ExecContext(ctx, `INSERT INTO autobroadcast (realmid, text, weight) VALUES (?, ?, ?)`, req.Realmid, text, req.Weight)
	if err != nil {
		// try without realmid
		res, err = db.ExecContext(ctx, `INSERT INTO autobroadcast (text, weight) VALUES (?, ?)`, text, req.Weight)
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	id, _ := res.LastInsertId()
	JSON(c, gin.H{"id": id, "created": true, "source": source})
}

func (s *Server) deleteAutobroadcast(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
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
	res, err := rt.DB.Auth.ExecContext(c.Request.Context(), `DELETE FROM autobroadcast WHERE id = ?`, id)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	JSON(c, gin.H{"deleted": id, "affected": n})
}

type confSpec struct {
	id   string
	path string
}

func confFileSpecs(conf config.ConfPaths) []confSpec {
	out := []confSpec{}
	if conf.WorldserverConf != "" {
		out = append(out, confSpec{"worldserver", conf.WorldserverConf})
	} else if conf.EtcDir != "" {
		out = append(out, confSpec{"worldserver", filepath.Join(conf.EtcDir, "worldserver.conf")})
	}
	if conf.AuthserverConf != "" {
		out = append(out, confSpec{"authserver", conf.AuthserverConf})
	} else if conf.EtcDir != "" {
		out = append(out, confSpec{"authserver", filepath.Join(conf.EtcDir, "authserver.conf")})
	}
	if p := resolvePlayerbotsConfPath(conf); p != "" {
		out = append(out, confSpec{"playerbots", p})
	}
	return out
}

func resolveConfFile(conf config.ConfPaths, id string) (string, error) {
	id = strings.ToLower(strings.TrimSpace(id))
	for _, item := range confFileSpecs(conf) {
		if item.id == id {
			return item.path, nil
		}
	}
	return "", fmt.Errorf("unknown conf id")
}

func (s *Server) getConfigFile(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	path, err := resolveConfFile(rt.Cfg.Conf, id)
	if err != nil {
		// try etc/modules
		etcMods := rt.Cfg.Modules.EtcModulesDir
		if etcMods == "" && rt.Cfg.Conf.EtcDir != "" {
			etcMods = filepath.Join(rt.Cfg.Conf.EtcDir, "modules")
		}
		path, err = modules.ResolveModuleConf(etcMods, id)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	if len(raw) > 2*1024*1024 {
		Fail(c, http.StatusBadRequest, "bad_request", "file too large")
		return
	}
	JSON(c, gin.H{"id": id, "path": path, "content": string(raw)})
}

func (s *Server) putConfigFile(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	path, err := resolveConfFile(rt.Cfg.Conf, id)
	if err != nil {
		etcMods := rt.Cfg.Modules.EtcModulesDir
		if etcMods == "" && rt.Cfg.Conf.EtcDir != "" {
			etcMods = filepath.Join(rt.Cfg.Conf.EtcDir, "modules")
		}
		path, err = modules.ResolveModuleConf(etcMods, id)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
	}
	var req struct {
		Content string `json:"content"`
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
	if len(req.Content) > 2*1024*1024 {
		Fail(c, http.StatusBadRequest, "bad_request", "content too large")
		return
	}
	bak := path + ".bak." + time.Now().Format("20060102-150405")
	if raw, err := os.ReadFile(path); err == nil {
		_ = os.WriteFile(bak, raw, 0o644)
	}
	if err := os.WriteFile(path, []byte(req.Content), 0o644); err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "conf.write", Detail: path, OK: true,
	})
	JSON(c, gin.H{"path": path, "backup": bak})
}

func updateConfKeys(path string, updates map[string]string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	bak := path + ".bak." + time.Now().Format("20060102-150405")
	_ = os.WriteFile(bak, raw, 0o644)
	lines := strings.Split(string(raw), "\n")
	seen := map[string]bool{}
	for i, line := range lines {
		m := confLineRe.FindStringSubmatch(line)
		if len(m) < 5 {
			continue
		}
		key := m[2]
		if val, ok := updates[key]; ok {
			lines[i] = m[1] + key + m[3] + val + m[5]
			seen[key] = true
		}
	}
	for k, v := range updates {
		if !seen[k] {
			lines = append(lines, fmt.Sprintf("%s = %s", k, v))
		}
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644)
}

func isSafeIdent(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func stringifySQL(v any) any {
	switch t := v.(type) {
	case nil:
		return nil
	case []byte:
		return string(t)
	default:
		return t
	}
}
