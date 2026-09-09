package httpapi

import (
	"log"
	"time"

	"acmanage/internal/applog"

	"github.com/gin-gonic/gin"
)

const ctxErrMsgKey = "api_error_message"
const ctxErrCodeKey = "api_error_code"

func setAPIError(c *gin.Context, code, message string) {
	c.Set(ctxErrCodeKey, code)
	c.Set(ctxErrMsgKey, message)
}

// requestLogger writes access lines; failed responses also go to error.log.
func requestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		query := c.Request.URL.RawQuery
		c.Next()

		latency := time.Since(start)
		status := c.Writer.Status()
		user := Username(c)
		if user == "" {
			user = "-"
		}
		target := TargetID(c)
		if target == "" {
			target = "-"
		}
		fullPath := path
		if query != "" {
			fullPath = path + "?" + query
		}

		line := "[http] status=%d method=%s path=%s latency=%s client=%s user=%s target=%s"
		args := []any{status, c.Request.Method, fullPath, latency, c.ClientIP(), user, target}

		if status >= 400 {
			code, _ := c.Get(ctxErrCodeKey)
			msg, _ := c.Get(ctxErrMsgKey)
			if code == nil {
				code = "-"
			}
			if msg == nil {
				msg = "-"
			}
			applog.Errorf(line+" err_code=%v err=%v", append(args, code, msg)...)
			return
		}
		log.Printf(line, args...)
	}
}
