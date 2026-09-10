package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"acmanage/internal/audit"
	"acmanage/internal/config"
	"acmanage/internal/modules"

	"github.com/gin-gonic/gin"
)

func (s *Server) checkpointBase() string {
	dir := s.app.Cfg.Modules.CheckpointDir
	if dir == "" {
		dir = "../data/module-checkpoints"
	}
	return dir
}

func worldContainerRef(t *config.Target) string {
	if t.Docker.Containers != nil {
		if n := t.Docker.Containers["worldserver"]; n != "" {
			return "worldserver"
		}
	}
	if t.Modules.WorldService != "" {
		return t.Modules.WorldService
	}
	return "worldserver"
}

func (s *Server) listModuleCheckpoints(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	items, err := modules.List(s.checkpointBase(), rt.Cfg.ID)
	if err != nil {
		Fail(c, http.StatusBadGateway, "checkpoint_failed", err.Error())
		return
	}
	JSON(c, gin.H{"items": items, "keep": rt.Cfg.Modules.CheckpointKeep})
}

func (s *Server) getModuleCheckpoint(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	meta, err := modules.Load(s.checkpointBase(), id)
	if err != nil {
		if os.IsNotExist(err) {
			FailCode(c, http.StatusNotFound, "checkpoint_not_found")
			return
		}
		Fail(c, http.StatusBadGateway, "checkpoint_failed", err.Error())
		return
	}
	if meta.TargetID != "" && meta.TargetID != rt.Cfg.ID {
		FailCode(c, http.StatusNotFound, "checkpoint_not_found")
		return
	}
	JSON(c, meta)
}

func (s *Server) createModuleCheckpoint(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Confirm bool   `json:"confirm"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		FailCode(c, http.StatusBadRequest, "confirm_required")
		return
	}

	unlock := modules.LockTarget(rt.Cfg.ID)
	if unlock == nil {
		FailCode(c, http.StatusConflict, "job_conflict")
		return
	}
	defer unlock()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Minute)
	defer cancel()

	inv := s.buildInventory(c, rt)
	installed := make([]modules.InstalledSnapshot, 0, len(inv.Items))
	for _, it := range inv.Items {
		installed = append(installed, modules.InstalledSnapshot{ID: it.ID, Commit: it.Commit})
	}

	meta, err := modules.Create(ctx, modules.CreateOpts{
		Target:        rt.Cfg,
		CheckpointDir: s.checkpointBase(),
		Docker:        rt.Docker,
		MysqldumpPath: rt.Cfg.Backup.MysqldumpPath,
		Reason:        req.Reason,
		CoreRevision:  inv.Core.Revision,
		Installed:     installed,
		WorldRole:     worldContainerRef(rt.Cfg),
	})
	if err != nil {
		_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
			Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
			Action: "modules.checkpoint.create", Detail: err.Error(), OK: false,
		})
		Fail(c, http.StatusBadGateway, "checkpoint_failed", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.checkpoint.create", Detail: meta.ID, OK: true,
	})
	JSON(c, meta)
}

// createModuleCheckpointStream creates a checkpoint and streams step progress via SSE.
func (s *Server) createModuleCheckpointStream(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Confirm bool   `json:"confirm"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		FailCode(c, http.StatusBadRequest, "confirm_required")
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Fail(c, http.StatusInternalServerError, "checkpoint_failed", "streaming unsupported")
		return
	}

	unlock := modules.LockTarget(rt.Cfg.ID)
	if unlock == nil {
		FailCode(c, http.StatusConflict, "job_conflict")
		return
	}
	defer unlock()

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

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Minute)
	defer cancel()

	inv := s.buildInventory(c, rt)
	installed := make([]modules.InstalledSnapshot, 0, len(inv.Items))
	for _, it := range inv.Items {
		installed = append(installed, modules.InstalledSnapshot{ID: it.ID, Commit: it.Commit})
	}

	meta, err := modules.Create(ctx, modules.CreateOpts{
		Target:        rt.Cfg,
		CheckpointDir: s.checkpointBase(),
		Docker:        rt.Docker,
		MysqldumpPath: rt.Cfg.Backup.MysqldumpPath,
		Reason:        req.Reason,
		CoreRevision:  inv.Core.Revision,
		Installed:     installed,
		WorldRole:     worldContainerRef(rt.Cfg),
		OnStep: func(step modules.CheckpointStep) {
			writeSSE("step", step)
		},
	})
	if err != nil {
		_ = s.app.Audit.Write(context.Background(), audit.Entry{
			Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
			Action: "modules.checkpoint.create", Detail: err.Error(), OK: false,
		})
		writeSSE("error", gin.H{"code": "checkpoint_failed", "message": err.Error()})
		return
	}
	_ = s.app.Audit.Write(context.Background(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.checkpoint.create", Detail: meta.ID, OK: true,
	})
	writeSSE("done", meta)
}

func (s *Server) rollbackModuleCheckpoint(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	var req struct {
		Confirm       bool   `json:"confirm"`
		ConfirmPhrase string `json:"confirm_phrase"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		FailCode(c, http.StatusBadRequest, "confirm_required")
		return
	}
	if strings.TrimSpace(req.ConfirmPhrase) != id {
		FailCode(c, http.StatusBadRequest, "confirm_phrase_mismatch")
		return
	}

	unlock := modules.LockTarget(rt.Cfg.ID)
	if unlock == nil {
		FailCode(c, http.StatusConflict, "job_conflict")
		return
	}
	defer unlock()

	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Minute)
	defer cancel()

	result, err := modules.Rollback(ctx, modules.RollbackOpts{
		Target:        rt.Cfg,
		CheckpointDir: s.checkpointBase(),
		Docker:        rt.Docker,
		WorldRole:     worldContainerRef(rt.Cfg),
	}, id)
	if err != nil {
		code := "checkpoint_failed"
		msg := err.Error()
		if strings.Contains(msg, "image_tag_missing") {
			code = "image_tag_missing"
		} else if os.IsNotExist(err) || strings.Contains(msg, "invalid checkpoint") {
			code = "checkpoint_not_found"
		}
		_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
			Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
			Action: "modules.checkpoint.rollback", Detail: id + ": " + msg, OK: false,
		})
		status := http.StatusBadGateway
		if code == "checkpoint_not_found" {
			status = http.StatusNotFound
		} else if code == "image_tag_missing" {
			status = http.StatusConflict
		}
		Fail(c, status, code, msg)
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.checkpoint.rollback", Detail: id, OK: true,
	})
	JSON(c, result)
}

func (s *Server) deleteModuleCheckpoint(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id := c.Param("id")
	var req struct {
		Confirm bool `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&req)
	if !req.Confirm {
		FailCode(c, http.StatusBadRequest, "confirm_required")
		return
	}
	unlock := modules.LockTarget(rt.Cfg.ID)
	if unlock == nil {
		FailCode(c, http.StatusConflict, "job_conflict")
		return
	}
	defer unlock()

	if err := modules.Delete(c.Request.Context(), s.checkpointBase(), rt.Cfg.ID, id, rt.Docker); err != nil {
		if os.IsNotExist(err) || strings.Contains(err.Error(), "invalid checkpoint") {
			FailCode(c, http.StatusNotFound, "checkpoint_not_found")
			return
		}
		Fail(c, http.StatusBadGateway, "checkpoint_failed", err.Error())
		return
	}
	_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
		Username: Username(c), Role: Role(c), TargetID: rt.Cfg.ID,
		Action: "modules.checkpoint.delete", Detail: id, OK: true,
	})
	JSON(c, gin.H{"id": id, "deleted": true})
}
