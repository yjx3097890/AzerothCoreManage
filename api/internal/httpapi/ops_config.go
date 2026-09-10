package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
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
	for _, item := range confFileSpecs(rt.Cfg) {
		st, err := os.Stat(item.path)
		entry := gin.H{"id": item.id, "path": item.path, "available": err == nil, "label": item.label}
		if err == nil {
			entry["size"] = st.Size()
			entry["mod_time"] = st.ModTime()
		} else {
			entry["error"] = err.Error()
		}
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
	result, err := s.runDBBackup(c.Request.Context(), rt.Cfg, nil)
	if err != nil {
		_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
			Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
			Action: "backup.mysqldump", Detail: err.Error(), OK: false,
		})
		Fail(c, http.StatusBadGateway, "backup_error", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "backup.mysqldump", Detail: result.Dir, OK: true,
	})
	JSON(c, result)
}

func (s *Server) createBackupStream(c *gin.Context) {
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
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Fail(c, http.StatusInternalServerError, "backup_error", "streaming unsupported")
		return
	}
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher.Flush()

	writeSSE := func(event string, payload any) {
		b, _ := json.Marshal(payload)
		_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, b)
		flusher.Flush()
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Minute)
	defer cancel()

	result, err := s.runDBBackup(ctx, rt.Cfg, func(step modules.CheckpointStep) {
		writeSSE("step", step)
	})
	if err != nil {
		_ = s.app.Audit.Write(context.Background(), audit.Entry{
			Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
			Action: "backup.mysqldump", Detail: err.Error(), OK: false,
		})
		writeSSE("error", gin.H{"code": "backup_error", "message": err.Error()})
		return
	}
	_ = s.app.Audit.Write(context.Background(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "backup.mysqldump", Detail: result.Dir, OK: true,
	})
	writeSSE("done", result)
}

type dbBackupResult struct {
	Dir       string                   `json:"dir"`
	Stamp     string                   `json:"stamp"`
	Mysqldump string                   `json:"mysqldump"`
	Files     []gin.H                  `json:"files"`
	Steps     []modules.CheckpointStep `json:"steps,omitempty"`
}

func (s *Server) runDBBackup(ctx context.Context, cfg *config.Target, onStep modules.StepReporter) (*dbBackupResult, error) {
	report := func(id, label, status, detail string) {
		step := modules.CheckpointStep{ID: id, Label: label, Status: status, Detail: detail}
		if onStep != nil {
			onStep(step)
		}
	}
	record := func(steps *[]modules.CheckpointStep, id, label, status, detail string) {
		report(id, label, status, detail)
		if status == "running" {
			return
		}
		*steps = append(*steps, modules.CheckpointStep{ID: id, Label: label, Status: status, Detail: detail})
	}

	steps := []modules.CheckpointStep{}
	dir := backupDir(cfg)
	report("prepare", "准备备份目录", "running", dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		record(&steps, "prepare", "准备备份目录", "fail", err.Error())
		return nil, err
	}
	record(&steps, "prepare", "准备备份目录", "ok", dir)

	report("mysqldump", "定位 mysqldump", "running", "")
	dump, err := modules.ResolveMysqldump(cfg.Backup.MysqldumpPath)
	if err != nil {
		record(&steps, "mysqldump", "定位 mysqldump", "fail", err.Error())
		return nil, err
	}
	record(&steps, "mysqldump", "定位 mysqldump", "ok", dump)

	stamp := time.Now().Format("20060102-150405")
	dbs := []struct {
		name  string
		db    string
		label string
	}{
		{"auth", cfg.MySQL.AuthDB, "备份 auth 库"},
		{"characters", cfg.MySQL.CharactersDB, "备份 characters 库"},
		{"world", cfg.MySQL.WorldDB, "备份 world 库"},
		{"playerbots", cfg.MySQL.PlayerbotsDB, "备份 playerbots 库"},
	}
	files := []gin.H{}
	okCount := 0
	var firstErr string
	for _, d := range dbs {
		stepID := "sql." + d.name
		if d.db == "" {
			record(&steps, stepID, d.label, "skip", "未配置")
			continue
		}
		report(stepID, d.label, "running", d.db)
		outPath := filepath.Join(dir, fmt.Sprintf("%s-%s-%s.sql", stamp, cfg.ID, d.name))
		args := []string{
			"-h", cfg.MySQL.Host,
			"-P", fmt.Sprintf("%d", cfg.MySQL.Port),
			"-u", cfg.MySQL.User,
			"--single-transaction",
			"--routines",
			"--triggers",
			"--result-file=" + outPath,
			d.db,
		}
		cmd := exec.CommandContext(ctx, dump, args...)
		cmd.Env = append(os.Environ(), "MYSQL_PWD="+cfg.MySQL.Password)
		var stderr strings.Builder
		cmd.Stderr = &stderr
		runErr := cmd.Run()
		st, _ := os.Stat(outPath)
		size := int64(0)
		if st != nil {
			size = st.Size()
		}
		entry := gin.H{"db": d.name, "file": outPath, "size": size, "ok": runErr == nil && size > 0}
		if runErr != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = runErr.Error()
			}
			entry["error"] = msg
			if firstErr == "" {
				firstErr = d.name + ": " + msg
			}
			_ = os.Remove(outPath)
			record(&steps, stepID, d.label, "fail", msg)
		} else if size == 0 {
			entry["ok"] = false
			entry["error"] = "empty dump"
			if firstErr == "" {
				firstErr = d.name + ": empty dump"
			}
			_ = os.Remove(outPath)
			record(&steps, stepID, d.label, "fail", "empty dump")
		} else {
			okCount++
			record(&steps, stepID, d.label, "ok", fmt.Sprintf("%d bytes", size))
		}
		files = append(files, entry)
	}
	if okCount == 0 {
		if firstErr == "" {
			firstErr = "no databases configured"
		}
		return nil, fmt.Errorf("%s", firstErr)
	}
	return &dbBackupResult{
		Dir:       dir,
		Stamp:     stamp,
		Mysqldump: dump,
		Files:     files,
		Steps:     steps,
	}, nil
}

func backupDir(cfg *config.Target) string {
	dir := cfg.Backup.Dir
	if dir == "" {
		dir = filepath.Join("..", "data", "backups")
	}
	return dir
}

type backupSet struct {
	Stamp     string         `json:"stamp"`
	TargetID  string         `json:"target_id"`
	CreatedAt time.Time      `json:"created_at"`
	Files     []backupFile   `json:"files"`
	DBs       []string       `json:"dbs"`
}

type backupFile struct {
	DB   string `json:"db"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

var backupNameRe = regexp.MustCompile(`^(\d{8}-\d{6})-([A-Za-z0-9_-]+)-(auth|characters|world|playerbots)\.sql$`)

func (s *Server) listBackups(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	dir := backupDir(rt.Cfg)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			JSON(c, gin.H{"dir": dir, "items": []backupSet{}})
			return
		}
		Fail(c, http.StatusBadGateway, "backup_error", err.Error())
		return
	}
	byKey := map[string]*backupSet{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		m := backupNameRe.FindStringSubmatch(name)
		if m == nil {
			continue
		}
		stamp, targetID, dbName := m[1], m[2], m[3]
		if targetID != rt.Cfg.ID {
			continue
		}
		key := stamp + "|" + targetID
		set := byKey[key]
		if set == nil {
			created, _ := time.ParseInLocation("20060102-150405", stamp, time.Local)
			set = &backupSet{Stamp: stamp, TargetID: targetID, CreatedAt: created, Files: nil, DBs: nil}
			byKey[key] = set
		}
		info, _ := e.Info()
		var size int64
		if info != nil {
			size = info.Size()
		}
		set.Files = append(set.Files, backupFile{DB: dbName, Name: name, Size: size})
		set.DBs = append(set.DBs, dbName)
	}
	items := make([]backupSet, 0, len(byKey))
	for _, set := range byKey {
		items = append(items, *set)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Stamp > items[j].Stamp
	})
	JSON(c, gin.H{"dir": dir, "items": items})
}

func (s *Server) deleteBackup(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	stamp := strings.TrimSpace(c.Param("stamp"))
	if !regexp.MustCompile(`^\d{8}-\d{6}$`).MatchString(stamp) {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var req struct {
		Confirm bool `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&req)
	if !req.Confirm {
		FailCode(c, http.StatusBadRequest, "confirm_required")
		return
	}
	dir := backupDir(rt.Cfg)
	removed := []string{}
	for _, key := range []string{"auth", "characters", "world", "playerbots"} {
		path := filepath.Join(dir, fmt.Sprintf("%s-%s-%s.sql", stamp, rt.Cfg.ID, key))
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := os.Remove(path); err != nil {
			Fail(c, http.StatusBadGateway, "backup_error", err.Error())
			return
		}
		removed = append(removed, key)
	}
	if len(removed) == 0 {
		FailCode(c, http.StatusNotFound, "not_found")
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "backup.delete", Detail: stamp, OK: true,
	})
	JSON(c, gin.H{"stamp": stamp, "removed": removed})
}

func (s *Server) restoreBackup(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Confirm       bool   `json:"confirm"`
		Stamp         string `json:"stamp"`
		ConfirmPhrase string `json:"confirm_phrase"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Stamp) == "" {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		FailCode(c, http.StatusBadRequest, "confirm_required")
		return
	}
	stamp := strings.TrimSpace(req.Stamp)
	if !regexp.MustCompile(`^\d{8}-\d{6}$`).MatchString(stamp) {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if strings.TrimSpace(req.ConfirmPhrase) != stamp {
		FailCode(c, http.StatusBadRequest, "confirm_phrase_mismatch")
		return
	}

	dir := backupDir(rt.Cfg)
	dbMap := map[string]string{
		"auth":       rt.Cfg.MySQL.AuthDB,
		"characters": rt.Cfg.MySQL.CharactersDB,
		"world":      rt.Cfg.MySQL.WorldDB,
		"playerbots": rt.Cfg.MySQL.PlayerbotsDB,
	}
	imported := []string{}
	warnings := []string{}

	// Best-effort stop world before import when Docker is available.
	if rt.Docker != nil {
		if err := rt.Docker.Stop(c.Request.Context(), worldContainerRef(rt.Cfg)); err != nil {
			warnings = append(warnings, "stop world: "+err.Error())
		}
	}

	for _, key := range []string{"auth", "characters", "world", "playerbots"} {
		dbName := dbMap[key]
		if dbName == "" {
			continue
		}
		path := filepath.Join(dir, fmt.Sprintf("%s-%s-%s.sql", stamp, rt.Cfg.ID, key))
		if _, err := os.Stat(path); err != nil {
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			Fail(c, http.StatusBadGateway, "backup_error", err.Error())
			return
		}
		args := []string{
			"-h", rt.Cfg.MySQL.Host,
			"-P", fmt.Sprintf("%d", rt.Cfg.MySQL.Port),
			"-u", rt.Cfg.MySQL.User,
			dbName,
		}
		cmd := exec.CommandContext(c.Request.Context(), "mysql", args...)
		cmd.Env = append(os.Environ(), "MYSQL_PWD="+rt.Cfg.MySQL.Password)
		cmd.Stdin = f
		var stderr strings.Builder
		cmd.Stderr = &stderr
		runErr := cmd.Run()
		_ = f.Close()
		if runErr != nil {
			_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
				Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
				Action: "backup.restore", Detail: stamp + ": " + runErr.Error(), OK: false,
			})
			Fail(c, http.StatusBadGateway, "backup_error", fmt.Sprintf("%s: %v %s", key, runErr, strings.TrimSpace(stderr.String())))
			return
		}
		imported = append(imported, key)
	}
	if len(imported) == 0 {
		Fail(c, http.StatusNotFound, "not_found", "no backup files for stamp")
		return
	}

	worldStarted := false
	if rt.Docker != nil {
		if err := rt.Docker.Start(c.Request.Context(), worldContainerRef(rt.Cfg)); err != nil {
			warnings = append(warnings, "start world: "+err.Error())
		} else {
			worldStarted = true
		}
	}

	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "backup.restore", Detail: stamp, OK: true,
	})
	JSON(c, gin.H{
		"stamp":         stamp,
		"imported":      imported,
		"world_started": worldStarted,
		"warnings":      warnings,
	})
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
	id    string
	label string
	path  string
}

// confFileSpecs lists only core ops files on the Config page:
// worldserver, authserver, and docker-compose.override.yml.
// Module .conf files (including playerbots) live under Modules → installed.
func confFileSpecs(t *config.Target) []confSpec {
	conf := t.Conf
	out := []confSpec{}
	if conf.WorldserverConf != "" {
		out = append(out, confSpec{"worldserver", "World Server", conf.WorldserverConf})
	} else if conf.EtcDir != "" {
		out = append(out, confSpec{"worldserver", "World Server", filepath.Join(conf.EtcDir, "worldserver.conf")})
	}
	if conf.AuthserverConf != "" {
		out = append(out, confSpec{"authserver", "Auth Server", conf.AuthserverConf})
	} else if conf.EtcDir != "" {
		out = append(out, confSpec{"authserver", "Auth Server", filepath.Join(conf.EtcDir, "authserver.conf")})
	}
	if p := resolveComposeOverridePath(t); p != "" {
		out = append(out, confSpec{"compose_override", "Docker Compose Override", p})
	}
	return out
}

func resolveComposeOverridePath(t *config.Target) string {
	if t == nil {
		return ""
	}
	dir := strings.TrimSpace(t.Modules.ComposeDir)
	if dir == "" {
		return ""
	}
	candidates := []string{
		filepath.Join(dir, "docker-compose.override.yml"),
		filepath.Join(dir, "compose.override.yml"),
		filepath.Join(dir, "docker-compose.override.yaml"),
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	// Default path even if missing (editor can create on first save).
	return candidates[0]
}

func resolveConfFile(t *config.Target, id string) (string, error) {
	id = strings.ToLower(strings.TrimSpace(id))
	for _, item := range confFileSpecs(t) {
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
	path, err := resolveConfFile(rt.Cfg, id)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && id == "compose_override" {
			JSON(c, gin.H{"id": id, "path": path, "content": "", "missing": true})
			return
		}
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
	path, err := resolveConfFile(rt.Cfg, id)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
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
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	bak := ""
	if raw, err := os.ReadFile(path); err == nil {
		bak = path + ".bak." + time.Now().Format("20060102-150405")
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

func (s *Server) backupConfigFile(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	path, err := resolveConfFile(rt.Cfg, id)
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
	raw, err := os.ReadFile(path)
	if err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	bak := path + ".bak." + time.Now().Format("20060102-150405")
	if err := os.WriteFile(bak, raw, 0o644); err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "conf.backup", Detail: bak, OK: true,
	})
	JSON(c, gin.H{"path": path, "backup": bak, "name": filepath.Base(bak), "size": len(raw)})
}

func (s *Server) listConfigFileBackups(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	path, err := resolveConfFile(rt.Cfg, id)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	prefix := base + ".bak."
	entries, err := os.ReadDir(dir)
	if err != nil {
		JSON(c, gin.H{"id": id, "path": path, "items": []gin.H{}})
		return
	}
	items := []gin.H{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasPrefix(name, prefix) {
			continue
		}
		full := filepath.Join(dir, name)
		entry := gin.H{"name": name, "path": full}
		if st, err := e.Info(); err == nil {
			entry["size"] = st.Size()
			entry["mod_time"] = st.ModTime()
		}
		items = append(items, entry)
	}
	sort.Slice(items, func(i, j int) bool {
		ai, _ := items[i]["name"].(string)
		aj, _ := items[j]["name"].(string)
		return ai > aj
	})
	JSON(c, gin.H{"id": id, "path": path, "items": items})
}

func (s *Server) restoreConfigFileBackup(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	path, err := resolveConfFile(rt.Cfg, id)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Backup  string `json:"backup"`
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
	name := filepath.Base(strings.TrimSpace(req.Backup))
	if name == "" || strings.Contains(name, "..") || name != strings.TrimSpace(req.Backup) {
		Fail(c, http.StatusBadRequest, "bad_request", "bad backup name")
		return
	}
	prefix := filepath.Base(path) + ".bak."
	if !strings.HasPrefix(name, prefix) {
		Fail(c, http.StatusBadRequest, "bad_request", "backup does not belong to this file")
		return
	}
	bakPath := filepath.Join(filepath.Dir(path), name)
	raw, err := os.ReadFile(bakPath)
	if err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	// Safety copy of current before restore.
	if cur, err := os.ReadFile(path); err == nil {
		safety := path + ".bak." + time.Now().Format("20060102-150405")
		_ = os.WriteFile(safety, cur, 0o644)
	}
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		Fail(c, http.StatusBadGateway, "conf_error", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "conf.restore", Detail: path + " <- " + name, OK: true,
	})
	JSON(c, gin.H{"path": path, "restored_from": bakPath, "content": string(raw)})
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
