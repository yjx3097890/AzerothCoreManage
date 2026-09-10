package modules

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"acmanage/internal/config"
	"acmanage/internal/dockerx"
)

// CheckpointMeta is persisted as meta.json inside a checkpoint directory.
type CheckpointMeta struct {
	ID                       string              `json:"id"`
	TargetID                 string              `json:"target_id"`
	CreatedAt                time.Time           `json:"created_at"`
	Reason                   string              `json:"reason,omitempty"`
	CoreRevision             string              `json:"core_revision,omitempty"`
	Deploy                   string              `json:"deploy"`
	WorldImage               string              `json:"world_image,omitempty"`
	WorldImageCheckpointTag  string              `json:"world_image_checkpoint_tag,omitempty"`
	ImageTagError            string              `json:"image_tag_error,omitempty"`
	WorldBinaryPath          string              `json:"world_binary_path,omitempty"`
	WorldBinarySHA256        string              `json:"world_binary_sha256,omitempty"`
	InstalledThen            []InstalledSnapshot `json:"installed_then,omitempty"`
	SQLFiles                 []string            `json:"sql_files"`
	CoreFiles                []string            `json:"core_files,omitempty"`
	Steps                    []CheckpointStep    `json:"steps,omitempty"`
	Warnings                 []string            `json:"warnings,omitempty"`
	Note                     string              `json:"note"`
}

// CheckpointStep records one create/rollback sub-task outcome.
type CheckpointStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Status string `json:"status"` // running | ok | fail | skip
	Detail string `json:"detail,omitempty"`
}

// StepReporter receives live progress during Create.
type StepReporter func(step CheckpointStep)

type InstalledSnapshot struct {
	ID     string `json:"id"`
	Commit string `json:"commit,omitempty"`
}

type RollbackResult struct {
	CheckpointID   string   `json:"checkpoint_id"`
	BinaryRestore  string   `json:"binary_restore"` // done | skipped
	ImageRestored  bool     `json:"image_restored"`
	SQLImported    []string `json:"sql_imported"`
	FilesRestored  bool     `json:"files_restored"`
	WorldStarted   bool     `json:"world_started"`
	Warnings       []string `json:"warnings,omitempty"`
}

type CreateOpts struct {
	Target        *config.Target
	CheckpointDir string
	Docker        *dockerx.Client
	MysqldumpPath string
	Reason        string
	CoreRevision  string
	Installed     []InstalledSnapshot
	WorldRole     string // docker whitelist role or name; default worldserver
	OnStep        StepReporter
}

type RollbackOpts struct {
	Target        *config.Target
	CheckpointDir string
	Docker        *dockerx.Client
	MySQLPath     string
	WorldRole     string
}

var (
	ckptMu    sync.Mutex
	ckptLocks = map[string]*sync.Mutex{}
)

// LockTarget serializes checkpoint create/rollback per target.
func LockTarget(targetID string) func() {
	ckptMu.Lock()
	m, ok := ckptLocks[targetID]
	if !ok {
		m = &sync.Mutex{}
		ckptLocks[targetID] = m
	}
	ckptMu.Unlock()
	if !m.TryLock() {
		return nil
	}
	return m.Unlock
}

func newCheckpointID() (string, error) {
	var b [2]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return time.Now().Format("20060102-150405") + "-" + hex.EncodeToString(b[:]), nil
}

func checkpointRoot(base, id string) string {
	return filepath.Join(base, id)
}

func CheckpointTag(id string) string {
	return "acmanage-ckpt-" + id
}

// Create builds a checkpoint package (SQL + files + optional image tag).
func Create(ctx context.Context, opts CreateOpts) (*CheckpointMeta, error) {
	report := func(id, label, status, detail string) {
		step := CheckpointStep{ID: id, Label: label, Status: status, Detail: detail}
		if opts.OnStep != nil {
			opts.OnStep(step)
		}
	}
	record := func(meta *CheckpointMeta, id, label, status, detail string) {
		report(id, label, status, detail)
		if status == "running" {
			return
		}
		meta.Steps = append(meta.Steps, CheckpointStep{ID: id, Label: label, Status: status, Detail: detail})
	}

	if opts.Target == nil {
		return nil, fmt.Errorf("nil target")
	}
	base := strings.TrimSpace(opts.CheckpointDir)
	if base == "" {
		base = filepath.Join("..", "data", "module-checkpoints")
	}
	report("prepare", "准备目录", "running", "")
	if err := os.MkdirAll(base, 0o755); err != nil {
		report("prepare", "准备目录", "fail", err.Error())
		return nil, err
	}
	id, err := newCheckpointID()
	if err != nil {
		report("prepare", "准备目录", "fail", err.Error())
		return nil, err
	}
	dir := checkpointRoot(base, id)
	if err := os.MkdirAll(filepath.Join(dir, "sql"), 0o755); err != nil {
		report("prepare", "准备目录", "fail", err.Error())
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(dir, "files", "etc-modules"), 0o755); err != nil {
		report("prepare", "准备目录", "fail", err.Error())
		return nil, err
	}

	paths := ResolvePaths(opts.Target)
	meta := &CheckpointMeta{
		ID:            id,
		TargetID:      opts.Target.ID,
		CreatedAt:     time.Now().UTC(),
		Reason:        strings.TrimSpace(opts.Reason),
		CoreRevision:  opts.CoreRevision,
		Deploy:        paths.Deploy,
		InstalledThen: opts.Installed,
		SQLFiles:      []string{},
		Steps:         []CheckpointStep{},
		Note:          "回退会丢失该时刻之后的角色进度",
	}
	if meta.Deploy == "" {
		meta.Deploy = "docker"
	}
	record(meta, "prepare", "准备目录", "ok", id)

	dump, err := ResolveMysqldump(opts.MysqldumpPath)
	if err != nil {
		record(meta, "mysqldump", "定位 mysqldump", "fail", err.Error())
		_ = os.RemoveAll(dir)
		return nil, err
	}
	record(meta, "mysqldump", "定位 mysqldump", "ok", dump)

	m := opts.Target.MySQL
	dbs := []struct {
		key   string
		db    string
		label string
	}{
		{"auth", m.AuthDB, "备份 auth 库"},
		{"characters", m.CharactersDB, "备份 characters 库"},
		{"world", m.WorldDB, "备份 world 库"},
		{"playerbots", m.PlayerbotsDB, "备份 playerbots 库"},
	}
	okDumps := 0
	for _, d := range dbs {
		stepID := "sql." + d.key
		if d.db == "" {
			record(meta, stepID, d.label, "skip", "未配置")
			continue
		}
		report(stepID, d.label, "running", d.db)
		outPath := filepath.Join(dir, "sql", d.key+".sql")
		args := []string{
			"-h", m.Host,
			"-P", fmt.Sprintf("%d", m.Port),
			"-u", m.User,
			"--single-transaction",
			"--routines",
			"--triggers",
			"--result-file=" + outPath,
			d.db,
		}
		cmd := exec.CommandContext(ctx, dump, args...)
		cmd.Env = append(os.Environ(), "MYSQL_PWD="+m.Password)
		var stderr strings.Builder
		cmd.Stderr = &stderr
		runErr := cmd.Run()
		st, _ := os.Stat(outPath)
		if runErr != nil {
			msg := strings.TrimSpace(stderr.String())
			if msg == "" {
				msg = runErr.Error()
			}
			meta.Warnings = append(meta.Warnings, fmt.Sprintf("sql %s dump: %s", d.key, msg))
			_ = os.Remove(outPath)
			record(meta, stepID, d.label, "fail", msg)
			continue
		}
		if st == nil || st.Size() == 0 {
			meta.Warnings = append(meta.Warnings, fmt.Sprintf("sql %s empty", d.key))
			_ = os.Remove(outPath)
			record(meta, stepID, d.label, "fail", "empty dump")
			continue
		}
		meta.SQLFiles = append(meta.SQLFiles, d.key)
		okDumps++
		record(meta, stepID, d.label, "ok", fmt.Sprintf("%d bytes", st.Size()))
	}
	if okDumps == 0 {
		_ = os.RemoveAll(dir)
		return nil, fmt.Errorf("all database dumps failed")
	}

	// modules.list（官方 installer 才有；手工装模块时可不存在）
	report("files.modules_list", "复制 modules.list", "running", paths.ModulesList)
	if paths.ModulesList == "" {
		record(meta, "files.modules_list", "复制 modules.list", "skip", "path empty")
	} else if _, err := os.Stat(paths.ModulesList); err != nil {
		if os.IsNotExist(err) {
			record(meta, "files.modules_list", "复制 modules.list", "skip", "file not found")
		} else {
			meta.Warnings = append(meta.Warnings, "modules.list: "+err.Error())
			record(meta, "files.modules_list", "复制 modules.list", "fail", err.Error())
		}
	} else if err := copyFile(paths.ModulesList, filepath.Join(dir, "files", "modules.list")); err != nil {
		meta.Warnings = append(meta.Warnings, "modules.list: "+err.Error())
		record(meta, "files.modules_list", "复制 modules.list", "fail", err.Error())
	} else {
		record(meta, "files.modules_list", "复制 modules.list", "ok", "")
	}

	// etc-modules directory
	report("files.etc_modules", "复制 etc/modules", "running", paths.EtcModulesDir)
	if paths.EtcModulesDir != "" {
		if st, err := os.Stat(paths.EtcModulesDir); err == nil && st.IsDir() {
			if err := copyDir(paths.EtcModulesDir, filepath.Join(dir, "files", "etc-modules")); err != nil {
				meta.Warnings = append(meta.Warnings, "etc-modules: "+err.Error())
				record(meta, "files.etc_modules", "复制 etc/modules", "fail", err.Error())
			} else {
				record(meta, "files.etc_modules", "复制 etc/modules", "ok", "")
			}
		} else {
			msg := "etc-modules unreadable"
			if err != nil {
				msg = err.Error()
			}
			meta.Warnings = append(meta.Warnings, msg)
			record(meta, "files.etc_modules", "复制 etc/modules", "fail", msg)
		}
	} else {
		meta.Warnings = append(meta.Warnings, "etc-modules path empty")
		record(meta, "files.etc_modules", "复制 etc/modules", "skip", "path empty")
	}

	// Core configs: worldserver / authserver / compose override / playerbots
	coreDir := filepath.Join(dir, "files", "core")
	if err := os.MkdirAll(coreDir, 0o755); err != nil {
		meta.Warnings = append(meta.Warnings, "core conf dir: "+err.Error())
	} else {
		meta.CoreFiles = []string{}
		for _, c := range ListCoreConfSnapshots(opts.Target) {
			stepID := "files.core." + c.ID
			label := "复制 " + c.Label
			if c.LivePath == "" {
				record(meta, stepID, label, "skip", "path empty")
				continue
			}
			report(stepID, label, "running", c.LivePath)
			st, err := os.Stat(c.LivePath)
			if err != nil || st.IsDir() {
				msg := "not found"
				if err != nil {
					msg = err.Error()
				}
				meta.Warnings = append(meta.Warnings, c.ID+": "+msg)
				record(meta, stepID, label, "skip", msg)
				continue
			}
			dst := filepath.Join(coreDir, c.StoreAs)
			if err := copyFile(c.LivePath, dst); err != nil {
				meta.Warnings = append(meta.Warnings, c.ID+": "+err.Error())
				record(meta, stepID, label, "fail", err.Error())
				continue
			}
			meta.CoreFiles = append(meta.CoreFiles, c.ID)
			record(meta, stepID, label, "ok", fmt.Sprintf("%d bytes", st.Size()))
		}
	}

	worldRole := opts.WorldRole
	if worldRole == "" {
		worldRole = "worldserver"
		if opts.Target.Modules.WorldService != "" {
			worldRole = opts.Target.Modules.WorldService
		}
	}

	if meta.Deploy == "docker" {
		tag := CheckpointTag(id)
		report("docker.image_tag", "Docker 镜像 tag", "running", tag)
		if opts.Docker == nil {
			meta.ImageTagError = "docker client unavailable"
			meta.Warnings = append(meta.Warnings, meta.ImageTagError)
			meta.WorldImageCheckpointTag = ""
			record(meta, "docker.image_tag", "Docker 镜像 tag", "fail", meta.ImageTagError)
		} else {
			imgRef, imgID, err := opts.Docker.ContainerImage(ctx, worldRole)
			if err != nil {
				meta.ImageTagError = err.Error()
				meta.Warnings = append(meta.Warnings, "image inspect: "+err.Error())
				meta.WorldImageCheckpointTag = ""
				record(meta, "docker.image_tag", "Docker 镜像 tag", "fail", err.Error())
			} else {
				meta.WorldImage = imgRef
				src := imgRef
				if src == "" {
					src = imgID
				}
				if err := opts.Docker.TagImage(ctx, src, tag); err != nil {
					meta.ImageTagError = err.Error()
					meta.Warnings = append(meta.Warnings, "image tag: "+err.Error())
					meta.WorldImageCheckpointTag = ""
					record(meta, "docker.image_tag", "Docker 镜像 tag", "fail", err.Error())
				} else {
					meta.WorldImageCheckpointTag = tag
					record(meta, "docker.image_tag", "Docker 镜像 tag", "ok", tag+" ← "+src)
				}
			}
		}
	} else {
		report("source.binary", "记录 worldserver 指纹", "running", "")
		bin := findWorldserverBinary(paths)
		if bin != "" {
			meta.WorldBinaryPath = bin
			if sum, err := fileSHA256(bin); err == nil {
				meta.WorldBinarySHA256 = sum
				record(meta, "source.binary", "记录 worldserver 指纹", "ok", bin)
			} else {
				meta.Warnings = append(meta.Warnings, "binary sha: "+err.Error())
				record(meta, "source.binary", "记录 worldserver 指纹", "fail", err.Error())
			}
		} else {
			meta.Warnings = append(meta.Warnings, "worldserver binary not found")
			record(meta, "source.binary", "记录 worldserver 指纹", "skip", "binary not found")
		}
	}

	report("meta", "写入 meta.json", "running", "")
	if err := writeMeta(dir, meta); err != nil {
		record(meta, "meta", "写入 meta.json", "fail", err.Error())
		_ = os.RemoveAll(dir)
		return nil, err
	}
	record(meta, "meta", "写入 meta.json", "ok", "")
	// rewrite meta with final steps list
	_ = writeMeta(dir, meta)

	keep := opts.Target.Modules.CheckpointKeep
	if keep <= 0 {
		keep = 5
	}
	report("prune", "裁剪旧检查点", "running", fmt.Sprintf("keep=%d", keep))
	if err := Prune(ctx, base, opts.Target.ID, keep, opts.Docker); err != nil {
		log.Printf("checkpoint prune: %v", err)
		record(meta, "prune", "裁剪旧检查点", "fail", err.Error())
	} else {
		record(meta, "prune", "裁剪旧检查点", "ok", fmt.Sprintf("keep=%d", keep))
	}
	_ = writeMeta(dir, meta)
	return meta, nil
}

// List returns checkpoints for a target, newest first.
func List(base, targetID string) ([]CheckpointMeta, error) {
	base = strings.TrimSpace(base)
	if base == "" {
		base = filepath.Join("..", "data", "module-checkpoints")
	}
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []CheckpointMeta{}, nil
		}
		return nil, err
	}
	out := make([]CheckpointMeta, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		meta, err := Load(base, e.Name())
		if err != nil {
			continue
		}
		if targetID != "" && meta.TargetID != targetID {
			continue
		}
		out = append(out, *meta)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out, nil
}

// Load reads meta.json for a checkpoint id.
func Load(base, id string) (*CheckpointMeta, error) {
	if !IsSafeCheckpointID(id) {
		return nil, fmt.Errorf("invalid checkpoint id")
	}
	b, err := os.ReadFile(filepath.Join(checkpointRoot(base, id), "meta.json"))
	if err != nil {
		return nil, err
	}
	var meta CheckpointMeta
	if err := json.Unmarshal(b, &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

// IsSafeCheckpointID validates id format used on disk.
func IsSafeCheckpointID(id string) bool {
	id = strings.TrimSpace(id)
	if id == "" || len(id) > 40 || strings.Contains(id, "..") || strings.ContainsAny(id, `/\`) {
		return false
	}
	for _, r := range id {
		if !(r == '-' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// Prune keeps the newest keep checkpoints for targetID; removes older dirs and best-effort rmi.
func Prune(ctx context.Context, base, targetID string, keep int, docker *dockerx.Client) error {
	if keep <= 0 {
		return nil
	}
	items, err := List(base, targetID)
	if err != nil {
		return err
	}
	if len(items) <= keep {
		return nil
	}
	for _, meta := range items[keep:] {
		if err := Delete(ctx, base, targetID, meta.ID, docker); err != nil {
			log.Printf("checkpoint prune %s: %v", meta.ID, err)
		}
	}
	return nil
}

// Delete removes one checkpoint directory and best-effort removes its Docker image tag.
func Delete(ctx context.Context, base, targetID, id string, docker *dockerx.Client) error {
	meta, err := Load(base, id)
	if err != nil {
		return err
	}
	if meta.TargetID != "" && targetID != "" && meta.TargetID != targetID {
		return fmt.Errorf("checkpoint belongs to another target")
	}
	if meta.WorldImageCheckpointTag != "" && docker != nil {
		if err := docker.RemoveImage(ctx, meta.WorldImageCheckpointTag); err != nil {
			log.Printf("checkpoint delete rmi %s: %v", meta.WorldImageCheckpointTag, err)
		}
	}
	return os.RemoveAll(checkpointRoot(base, id))
}

// Rollback restores image (docker), SQL dumps, and files from a checkpoint.
func Rollback(ctx context.Context, opts RollbackOpts, id string) (*RollbackResult, error) {
	if opts.Target == nil {
		return nil, fmt.Errorf("nil target")
	}
	base := strings.TrimSpace(opts.CheckpointDir)
	if base == "" {
		base = filepath.Join("..", "data", "module-checkpoints")
	}
	meta, err := Load(base, id)
	if err != nil {
		return nil, err
	}
	if meta.TargetID != "" && meta.TargetID != opts.Target.ID {
		return nil, fmt.Errorf("checkpoint belongs to another target")
	}
	dir := checkpointRoot(base, id)
	result := &RollbackResult{
		CheckpointID:  id,
		BinaryRestore: "skipped",
		SQLImported:   []string{},
	}
	paths := ResolvePaths(opts.Target)
	worldRole := opts.WorldRole
	if worldRole == "" {
		worldRole = "worldserver"
		if opts.Target.Modules.WorldService != "" {
			worldRole = opts.Target.Modules.WorldService
		}
	}

	deploy := meta.Deploy
	if deploy == "" {
		deploy = paths.Deploy
	}

	// 1. Stop world
	if opts.Docker != nil {
		if err := opts.Docker.Stop(ctx, worldRole); err != nil {
			result.Warnings = append(result.Warnings, "stop world: "+err.Error())
		}
	}

	// 2. Restore image (docker) — required when deploy=docker
	if deploy == "docker" {
		tag := meta.WorldImageCheckpointTag
		if tag == "" {
			return nil, fmt.Errorf("image_tag_missing")
		}
		if opts.Docker == nil {
			return nil, fmt.Errorf("image_tag_missing")
		}
		if !opts.Docker.ImageExists(ctx, tag) {
			return nil, fmt.Errorf("image_tag_missing")
		}
		if err := opts.Docker.RecreateFromImage(ctx, worldRole, tag); err != nil {
			return nil, fmt.Errorf("recreate image: %w", err)
		}
		result.ImageRestored = true
		// RecreateFromImage already starts; we may stop again before SQL import for safety.
		_ = opts.Docker.Stop(ctx, worldRole)
	} else {
		result.BinaryRestore = "skipped"
	}

	mysqlBin := opts.MySQLPath
	if mysqlBin == "" {
		mysqlBin = "mysql"
	}
	m := opts.Target.MySQL
	dbMap := map[string]string{
		"auth":       m.AuthDB,
		"characters": m.CharactersDB,
		"world":      m.WorldDB,
		"playerbots": m.PlayerbotsDB,
	}
	for _, key := range meta.SQLFiles {
		dbName := dbMap[key]
		if dbName == "" {
			result.Warnings = append(result.Warnings, "skip sql "+key+": db not configured")
			continue
		}
		sqlPath := filepath.Join(dir, "sql", key+".sql")
		if _, err := os.Stat(sqlPath); err != nil {
			result.Warnings = append(result.Warnings, "missing sql "+key)
			continue
		}
		if err := importSQL(ctx, mysqlBin, m, dbName, sqlPath); err != nil {
			return nil, fmt.Errorf("import %s: %w", key, err)
		}
		result.SQLImported = append(result.SQLImported, key)
	}

	// 4. Restore files
	listSrc := filepath.Join(dir, "files", "modules.list")
	if _, err := os.Stat(listSrc); err == nil && paths.ModulesList != "" {
		if err := os.MkdirAll(filepath.Dir(paths.ModulesList), 0o755); err == nil {
			if err := copyFile(listSrc, paths.ModulesList); err != nil {
				result.Warnings = append(result.Warnings, "restore modules.list: "+err.Error())
			} else {
				result.FilesRestored = true
			}
		}
	}
	etcSrc := filepath.Join(dir, "files", "etc-modules")
	if st, err := os.Stat(etcSrc); err == nil && st.IsDir() && paths.EtcModulesDir != "" {
		if err := os.MkdirAll(paths.EtcModulesDir, 0o755); err == nil {
			// Replace contents: remove existing files then copy
			_ = clearDir(paths.EtcModulesDir)
			if err := copyDir(etcSrc, paths.EtcModulesDir); err != nil {
				result.Warnings = append(result.Warnings, "restore etc-modules: "+err.Error())
			} else {
				result.FilesRestored = true
			}
		}
	}

	coreSrcDir := filepath.Join(dir, "files", "core")
	for _, c := range ListCoreConfSnapshots(opts.Target) {
		src := filepath.Join(coreSrcDir, c.StoreAs)
		if _, err := os.Stat(src); err != nil {
			continue
		}
		if c.LivePath == "" {
			result.Warnings = append(result.Warnings, "restore "+c.ID+": live path empty")
			continue
		}
		if err := os.MkdirAll(filepath.Dir(c.LivePath), 0o755); err != nil {
			result.Warnings = append(result.Warnings, "restore "+c.ID+": "+err.Error())
			continue
		}
		if err := copyFile(src, c.LivePath); err != nil {
			result.Warnings = append(result.Warnings, "restore "+c.ID+": "+err.Error())
			continue
		}
		result.FilesRestored = true
	}

	// 5. Start world
	if opts.Docker != nil {
		if err := opts.Docker.Start(ctx, worldRole); err != nil {
			result.Warnings = append(result.Warnings, "start world: "+err.Error())
		} else {
			result.WorldStarted = true
		}
	}

	return result, nil
}

func importSQL(ctx context.Context, mysqlBin string, m config.MySQL, dbName, sqlPath string) error {
	f, err := os.Open(sqlPath)
	if err != nil {
		return err
	}
	defer f.Close()
	args := []string{
		"-h", m.Host,
		"-P", fmt.Sprintf("%d", m.Port),
		"-u", m.User,
		dbName,
	}
	cmd := exec.CommandContext(ctx, mysqlBin, args...)
	cmd.Env = append(os.Environ(), "MYSQL_PWD="+m.Password)
	cmd.Stdin = f
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func writeMeta(dir string, meta *CheckpointMeta) error {
	b, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "meta.json"), b, 0o644)
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		return copyFile(path, target)
	})
}

func clearDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		_ = os.RemoveAll(filepath.Join(dir, e.Name()))
	}
	return nil
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func findWorldserverBinary(paths Paths) string {
	candidates := []string{}
	if paths.ComposeDir != "" {
		candidates = append(candidates,
			filepath.Join(paths.ComposeDir, "env", "dist", "bin", "worldserver"),
			filepath.Join(paths.ComposeDir, "bin", "worldserver"),
			filepath.Join(paths.ComposeDir, "build", "bin", "worldserver"),
		)
	}
	for _, p := range candidates {
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			return p
		}
	}
	return ""
}
