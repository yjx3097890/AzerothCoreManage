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
		"confirm_required":    "Confirmation required",
		"not_found":           "Not found",
		"modules_path_unavailable": "Module path unavailable",
		"evaluate_degraded":   "Evaluation degraded",
		"github_rate_limited": "GitHub API rate limited",
		"deepseek_unconfigured": "DeepSeek API key not configured",
		"conf_error":          "Config file I/O failed",
		"backup_error":        "Database backup failed",
		"checkpoint_failed":   "Checkpoint operation failed",
		"image_tag_missing":   "Checkpoint image tag missing",
		"checkpoint_not_found": "Checkpoint not found",
		"job_conflict":        "Another module job is running for this target",
		"confirm_phrase_mismatch": "Confirmation phrase does not match",
		"mybots_unconfigured": "mod-mybots is not configured (set MYBOTS_HOST / MYBOTS_TOKEN)",
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
		"confirm_required":    "需要二次确认",
		"not_found":           "未找到",
		"modules_path_unavailable": "模块路径不可用",
		"evaluate_degraded":   "评估降级",
		"github_rate_limited": "GitHub API 限流",
		"deepseek_unconfigured": "未配置 DeepSeek API Key",
		"conf_error":          "配置文件读写失败",
		"backup_error":        "数据库备份失败",
		"checkpoint_failed":   "检查点操作失败",
		"image_tag_missing":   "检查点镜像 tag 缺失",
		"checkpoint_not_found": "检查点不存在",
		"job_conflict":        "该目标已有模块任务进行中",
		"confirm_phrase_mismatch": "确认短语不匹配",
		"mybots_unconfigured": "未配置 mod-mybots（请设置 MYBOTS_HOST / MYBOTS_TOKEN）",
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
