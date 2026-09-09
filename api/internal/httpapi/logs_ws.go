package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
)

var logsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
}

func (s *Server) serverLogsWS(c *gin.Context) {
	tokenStr := c.Query("token")
	if tokenStr == "" {
		header := c.GetHeader("Authorization")
		tokenStr = strings.TrimPrefix(header, "Bearer ")
	}
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		return []byte(s.app.Cfg.Panel.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		FailCode(c, http.StatusUnauthorized, "invalid_token")
		return
	}
	if roleRank(claims.Role) < roleRank(RoleGM) {
		FailCode(c, http.StatusForbidden, "forbidden")
		return
	}

	rt, err := s.app.Target(c.Query("target"))
	if err != nil {
		rt, err = s.app.Target(TargetID(c))
	}
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	if !rt.Cfg.Docker.Enabled || rt.Docker == nil {
		Fail(c, http.StatusBadRequest, "docker_disabled", "docker disabled for this target")
		return
	}

	conn, err := logsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	level := strings.ToLower(strings.TrimSpace(c.Query("level")))
	name := c.Param("name")
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				cancel()
				return
			}
		}
	}()

	_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	_ = conn.WriteJSON(gin.H{"type": "ready", "container": name})

	err = rt.Docker.LogsFollow(ctx, name, c.DefaultQuery("tail", "100"), func(line string) error {
		if level != "" && !strings.Contains(strings.ToLower(line), level) {
			return nil
		}
		_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
		return conn.WriteJSON(gin.H{"type": "line", "line": line})
	})
	if err != nil && ctx.Err() == nil {
		_ = conn.WriteJSON(gin.H{"type": "error", "message": err.Error()})
	}
}
