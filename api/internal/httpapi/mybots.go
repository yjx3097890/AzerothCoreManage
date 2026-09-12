package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"acmanage/internal/app"
	"acmanage/internal/audit"
	"acmanage/internal/i18n"
	"acmanage/internal/mybots"

	"github.com/gin-gonic/gin"
)

func (s *Server) mybotsClient(c *gin.Context) (*app.TargetRuntime, *mybots.Client, bool) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return nil, nil, false
	}
	mb := rt.Cfg.MyBots
	if !mb.Configured() {
		FailCode(c, http.StatusServiceUnavailable, "mybots_unconfigured")
		return nil, nil, false
	}
	client := mybots.New(mb.Host, mb.Port, mb.Token, 8*time.Second)
	return rt, client, true
}

func (s *Server) proxyMyBots(c *gin.Context, method, path string, body any, auditAction string) {
	rt, client, ok := s.mybotsClient(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	res, err := client.Do(ctx, method, path, body)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mybots_unreachable", err.Error())
		return
	}
	s.finishMyBotsProxy(c, rt, res, auditAction, path)
}

func (s *Server) proxyMyBotsRaw(c *gin.Context, method, path string, raw []byte, auditAction string) {
	rt, client, ok := s.mybotsClient(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	res, err := client.DoRaw(ctx, method, path, raw)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mybots_unreachable", err.Error())
		return
	}
	s.finishMyBotsProxy(c, rt, res, auditAction, path)
}

func (s *Server) finishMyBotsProxy(c *gin.Context, rt *app.TargetRuntime, res *mybots.Result, auditAction, path string) {
	var payload any
	if err := json.Unmarshal(res.Body, &payload); err != nil {
		payload = gin.H{"raw": string(res.Body)}
	}

	if res.Status >= 200 && res.Status < 300 {
		if auditAction != "" {
			_ = s.app.Audit.Write(c.Request.Context(), audit.Entry{
				Username: Username(c),
				Role:     Role(c),
				TargetID: rt.Cfg.ID,
				Action:   auditAction,
				Detail:   path,
				OK:       true,
			})
		}
		JSON(c, payload)
		return
	}

	code := "mybots_error"
	msg := http.StatusText(res.Status)
	if m, ok := payload.(map[string]any); ok {
		if v, ok := m["code"].(string); ok && v != "" {
			code = v
		}
		if v, ok := m["message"].(string); ok && v != "" {
			msg = v
		}
	}
	switch res.Status {
	case http.StatusUnauthorized:
		code = "mybots_unauthorized"
	case http.StatusConflict:
		if code == "mybots_error" {
			code = "mybots_conflict"
		}
	case http.StatusTooManyRequests:
		code = "queue_full"
	case http.StatusNotFound:
		code = "not_found"
	}
	Fail(c, mapMyBotsStatus(res.Status), code, msg)
}

func mapMyBotsStatus(status int) int {
	switch status {
	case http.StatusAccepted:
		return http.StatusOK
	case http.StatusUnauthorized:
		return http.StatusBadGateway
	case http.StatusConflict, http.StatusTooManyRequests, http.StatusNotFound, http.StatusBadRequest:
		return status
	case http.StatusServiceUnavailable:
		return http.StatusBadGateway
	default:
		if status >= 500 {
			return http.StatusBadGateway
		}
		return status
	}
}

func (s *Server) mybotsStatus(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	mb := rt.Cfg.MyBots
	out := gin.H{
		"configured": mb.Configured(),
		"enabled":    mb.Enabled,
		"host":       mb.Host,
		"port":       mb.Port,
		"has_token":  strings.TrimSpace(mb.Token) != "" && strings.TrimSpace(mb.Token) != "change-me",
		"health":     nil,
	}
	if !mb.Configured() {
		JSON(c, out)
		return
	}
	client := mybots.New(mb.Host, mb.Port, mb.Token, 5*time.Second)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	res, err := client.Do(ctx, http.MethodGet, "/health", nil)
	if err != nil {
		out["health"] = gin.H{"ok": false, "error": err.Error()}
		JSON(c, out)
		return
	}
	var health any
	_ = json.Unmarshal(res.Body, &health)
	out["health"] = health
	out["health_status"] = res.Status
	JSON(c, out)
}

func (s *Server) mybotsHealth(c *gin.Context) {
	s.proxyMyBots(c, http.MethodGet, "/health", nil, "")
}

func (s *Server) mybotsGetCharacter(c *gin.Context) {
	rt, client, ok := s.mybotsClient(c)
	if !ok {
		return
	}
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	res, err := client.Do(ctx, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id), nil)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mybots_unreachable", err.Error())
		return
	}
	if res.Status < 200 || res.Status >= 300 {
		s.finishMyBotsProxy(c, rt, res, "", "/v1/characters/"+id)
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body, &payload); err != nil {
		s.finishMyBotsProxy(c, rt, res, "", "/v1/characters/"+id)
		return
	}
	loc := i18n.FromRequest(c)
	enrichMyBotsCharacter(payload, loc)
	_ = rt
	JSON(c, payload)
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	case int:
		return n, true
	case int64:
		return int(n), true
	case uint32:
		return int(n), true
	default:
		return 0, false
	}
}

func asFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func (s *Server) mybotsSelfbot(c *gin.Context) {
	id := c.Param("id")
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if len(raw) == 0 {
		raw = []byte(`{"enabled":true}`)
	}
	s.proxyMyBotsRaw(c, http.MethodPost, "/v1/characters/"+mybots.EscapePath(id)+"/selfbot", raw, "mybots.selfbot")
}

func (s *Server) mybotsListJobs(c *gin.Context) {
	id := c.Param("id")
	s.proxyMyBots(c, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id)+"/jobs", nil, "")
}

func (s *Server) mybotsCreateJob(c *gin.Context) {
	id := c.Param("id")
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil || len(raw) == 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	s.proxyMyBotsRaw(c, http.MethodPost, "/v1/characters/"+mybots.EscapePath(id)+"/jobs", raw, "mybots.job.create")
}

func (s *Server) mybotsGetJob(c *gin.Context) {
	id := c.Param("id")
	jobID := c.Param("jobId")
	s.proxyMyBots(c, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id)+"/jobs/"+mybots.EscapePath(jobID), nil, "")
}

func (s *Server) mybotsPauseJob(c *gin.Context) {
	id := c.Param("id")
	jobID := c.Param("jobId")
	s.proxyMyBots(c, http.MethodPost, "/v1/characters/"+mybots.EscapePath(id)+"/jobs/"+mybots.EscapePath(jobID)+"/pause", nil, "mybots.job.pause")
}

func (s *Server) mybotsResumeJob(c *gin.Context) {
	id := c.Param("id")
	jobID := c.Param("jobId")
	s.proxyMyBots(c, http.MethodPost, "/v1/characters/"+mybots.EscapePath(id)+"/jobs/"+mybots.EscapePath(jobID)+"/resume", nil, "mybots.job.resume")
}

func (s *Server) mybotsCancelJob(c *gin.Context) {
	id := c.Param("id")
	jobID := c.Param("jobId")
	s.proxyMyBots(c, http.MethodDelete, "/v1/characters/"+mybots.EscapePath(id)+"/jobs/"+mybots.EscapePath(jobID), nil, "mybots.job.cancel")
}

func (s *Server) mybotsCancelActiveJobs(c *gin.Context) {
	id := c.Param("id")
	s.proxyMyBots(c, http.MethodDelete, "/v1/characters/"+mybots.EscapePath(id)+"/jobs", nil, "mybots.job.cancel_all")
}

func (s *Server) mybotsEvents(c *gin.Context) {
	id := c.Param("id")
	s.proxyMyBots(c, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id)+"/events", nil, "")
}

func (s *Server) mybotsQuestLog(c *gin.Context) {
	id := c.Param("id")
	if live, ok := s.tryLiveMyBotsQuests(c, id, "quests"); ok {
		JSON(c, live)
		return
	}
	s.proxyMyBots(c, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id)+"/quests", nil, "")
}

func (s *Server) mybotsQuestsAvailable(c *gin.Context) {
	id := c.Param("id")
	if live, ok := s.tryLiveMyBotsQuests(c, id, "quests/available"); ok {
		JSON(c, live)
		return
	}
	s.proxyMyBots(c, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id)+"/quests/available", nil, "")
}

func (s *Server) mybotsListPatrols(c *gin.Context) {
	s.proxyMyBots(c, http.MethodGet, "/v1/patrols", nil, "")
}

func (s *Server) mybotsUpsertPatrol(c *gin.Context) {
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil || len(raw) == 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	s.proxyMyBotsRaw(c, http.MethodPost, "/v1/patrols", raw, "mybots.patrol.upsert")
}
