package i18n

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
)

type Locale string

const (
	ZH Locale = "zh-CN"
	EN Locale = "en-US"
)

var messages = map[Locale]map[string]string{
	EN: {
		"not_implemented":     "Skeleton placeholder, see docs/tasks.md %s",
		"unauthorized":        "Not signed in or session expired",
		"invalid_credentials": "Invalid username or password",
		"invalid_token":       "Invalid session token",
		"missing_token":       "Missing session token",
		"bad_request":         "Invalid request",
		"bad_target":          "Unknown target realm",
		"token":               "Failed to issue session token",
		"forbidden":           "Insufficient permissions",
	},
	ZH: {
		"not_implemented":     "骨架占位，见 docs/tasks.md %s",
		"unauthorized":        "未登录或登录已过期",
		"invalid_credentials": "用户名或密码错误",
		"invalid_token":       "登录凭证无效",
		"missing_token":       "缺少登录凭证",
		"bad_request":         "请求格式不正确",
		"bad_target":          "未知的目标服务器",
		"token":               "签发登录凭证失败",
		"forbidden":           "权限不足",
	},
}

func Parse(raw string) Locale {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if strings.HasPrefix(raw, "en") {
		return EN
	}
	return ZH
}

func FromRequest(c *gin.Context) Locale {
	if v := c.GetHeader("X-Locale"); v != "" {
		return Parse(v)
	}
	return Parse(c.GetHeader("Accept-Language"))
}

func T(loc Locale, key string, args ...any) string {
	table, ok := messages[loc]
	if !ok {
		table = messages[ZH]
	}
	tmpl, ok := table[key]
	if !ok {
		tmpl = messages[ZH][key]
	}
	if tmpl == "" {
		return key
	}
	if len(args) == 0 {
		return tmpl
	}
	return fmt.Sprintf(tmpl, args...)
}
