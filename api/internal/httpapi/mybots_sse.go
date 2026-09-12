package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"acmanage/internal/gamelocale"
	"acmanage/internal/i18n"
	"acmanage/internal/mybots"

	"github.com/gin-gonic/gin"
)

// mybotsCharacterLive streams character snapshot + quests via SSE.
// Events: ready | snapshot | quests | error
// Query: interval (seconds, default 2, clamped 1..10)
func (s *Server) mybotsCharacterLive(c *gin.Context) {
	rt, client, ok := s.mybotsClient(c)
	if !ok {
		return
	}
	_ = rt
	id := c.Param("id")
	if id == "" {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Fail(c, http.StatusInternalServerError, "mybots_error", "streaming unsupported")
		return
	}

	intervalSec, _ := strconv.Atoi(c.DefaultQuery("interval", "2"))
	if intervalSec < 1 {
		intervalSec = 1
	}
	if intervalSec > 10 {
		intervalSec = 10
	}
	interval := time.Duration(intervalSec) * time.Second

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	flusher.Flush()

	var mu sync.Mutex
	writeRaw := func(format string, args ...any) error {
		mu.Lock()
		defer mu.Unlock()
		if _, err := fmt.Fprintf(c.Writer, format, args...); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	}
	writeSSE := func(event string, payload any) error {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		return writeRaw("event: %s\ndata: %s\n\n", event, b)
	}

	if err := writeSSE("ready", gin.H{"id": id, "interval": intervalSec}); err != nil {
		return
	}

	ctx := c.Request.Context()
	loc := i18n.FromRequest(c)
	tick := time.NewTicker(interval)
	defer tick.Stop()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

		var lastSnapHash, lastQuestHash string
	pollOnce := func() {
		snapPayload, snapHash, err := fetchLiveSnapshot(ctx, client, id, loc)
		if err != nil {
			_ = writeSSE("error", gin.H{"message": err.Error(), "kind": "snapshot"})
		} else if snapHash != lastSnapHash {
			lastSnapHash = snapHash
			_ = writeSSE("snapshot", snapPayload)
		}

		questPayload, questHash, err := fetchLiveQuests(ctx, client, id)
		if err != nil {
			_ = writeSSE("error", gin.H{"message": err.Error(), "kind": "quests"})
		} else if questHash != lastQuestHash {
			lastQuestHash = questHash
			_ = writeSSE("quests", questPayload)
		}
	}

	pollOnce()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			if err := writeRaw(": ping\n\n"); err != nil {
				return
			}
		case <-tick.C:
			pollOnce()
		}
	}
}

func fetchLiveSnapshot(ctx context.Context, client *mybots.Client, id string, loc i18n.Locale) (map[string]any, string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	res, err := client.Do(reqCtx, http.MethodGet, "/v1/characters/"+mybots.EscapePath(id), nil)
	if err != nil {
		return nil, "", err
	}
	if res.Status < 200 || res.Status >= 300 {
		return nil, "", fmt.Errorf("mybots status %d", res.Status)
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body, &payload); err != nil {
		return nil, "", err
	}
	enrichMyBotsCharacter(payload, loc)
	hash := hashJSON(payload)
	return payload, hash, nil
}

func fetchLiveQuests(ctx context.Context, client *mybots.Client, id string) (map[string]any, string, error) {
	base := "/v1/characters/" + mybots.EscapePath(id)

	reqCtx1, cancel1 := context.WithTimeout(ctx, 5*time.Second)
	logRes, err := client.Do(reqCtx1, http.MethodGet, base+"/quests", nil)
	cancel1()
	if err != nil {
		return nil, "", err
	}

	reqCtx2, cancel2 := context.WithTimeout(ctx, 5*time.Second)
	availRes, err := client.Do(reqCtx2, http.MethodGet, base+"/quests/available", nil)
	cancel2()
	if err != nil {
		return nil, "", err
	}

	out := map[string]any{"source": "mybots"}
	if logRes.Status >= 200 && logRes.Status < 300 {
		var logBody map[string]any
		if json.Unmarshal(logRes.Body, &logBody) == nil {
			if items, ok := logBody["items"]; ok {
				out["log"] = items
			} else {
				out["log"] = []any{}
			}
		}
	} else {
		out["log"] = []any{}
		out["log_error"] = fmt.Sprintf("status %d", logRes.Status)
	}
	if availRes.Status >= 200 && availRes.Status < 300 {
		var availBody map[string]any
		if json.Unmarshal(availRes.Body, &availBody) == nil {
			if items, ok := availBody["items"]; ok {
				out["available"] = items
			} else {
				out["available"] = []any{}
			}
		}
	} else {
		out["available"] = []any{}
		out["available_error"] = fmt.Sprintf("status %d", availRes.Status)
	}
	hash := hashJSON(out)
	return out, hash, nil
}

func enrichMyBotsCharacter(payload map[string]any, loc i18n.Locale) {
	if v, ok := asInt(payload["map"]); ok {
		payload["map_name"] = gamelocale.MapName(v, loc)
	}
	if v, ok := asInt(payload["zone"]); ok {
		payload["zone_name"] = gamelocale.AreaName(v, loc)
	}
	if v, ok := asInt(payload["class"]); ok {
		payload["class_name"] = gamelocale.ClassName(v, loc)
	}
}

func hashJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:16])
}
