package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// serverLogsStream follows Docker container logs via SSE (text/event-stream).
// Events: ready | line | error | done
func (s *Server) serverLogsStream(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	if !rt.Cfg.Docker.Enabled || rt.Docker == nil {
		Fail(c, http.StatusBadRequest, "docker_disabled", "docker disabled for this target")
		return
	}

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		Fail(c, http.StatusInternalServerError, "docker_error", "streaming unsupported")
		return
	}

	level := strings.ToLower(strings.TrimSpace(c.Query("level")))
	name := c.Param("name")
	tail := c.DefaultQuery("tail", "100")

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

	if err := writeSSE("ready", gin.H{"container": name}); err != nil {
		return
	}

	ctx := c.Request.Context()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	errCh := make(chan error, 1)
	go func() {
		errCh <- rt.Docker.LogsFollow(ctx, name, tail, func(line string) error {
			if level != "" && !strings.Contains(strings.ToLower(line), level) {
				return nil
			}
			return writeSSE("line", gin.H{"line": line})
		})
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			// Keep proxies / browsers from idle-closing the stream.
			if err := writeRaw(": ping\n\n"); err != nil {
				return
			}
		case err := <-errCh:
			if err != nil && ctx.Err() == nil {
				_ = writeSSE("error", gin.H{"message": err.Error()})
			} else {
				_ = writeSSE("done", gin.H{"ok": true})
			}
			return
		}
	}
}
