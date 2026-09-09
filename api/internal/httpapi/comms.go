package httpapi

import (
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

var reMoney = regexp.MustCompile(`(?i)^(?:\d+g)?(?:\d+s)?(?:\d+c)?$`)

func (s *Server) announce(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Type    string `json:"type"` // announce | notify
		Message string `json:"message"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	msg := strings.TrimSpace(req.Message)
	if msg == "" || len(msg) > 255 {
		Fail(c, http.StatusBadRequest, "bad_request", "message required (max 255)")
		return
	}
	cmdType := strings.ToLower(strings.TrimSpace(req.Type))
	if cmdType == "" {
		cmdType = "announce"
	}
	if cmdType != "announce" && cmdType != "notify" {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	cmd := cmdType + " " + msg
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) getMOTD(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	result, err := s.execSOAP(c, rt, "server motd")
	if err != nil {
		return
	}
	byLocale := parseMotdByLocale(result)
	JSON(c, gin.H{"motd": result, "raw": result, "by_locale": byLocale})
}

func parseMotdByLocale(raw string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" {
			continue
		}
		idx := strings.IndexByte(line, ':')
		if idx <= 0 {
			continue
		}
		code := strings.TrimSpace(line[:idx])
		if !motdLocales[code] {
			continue
		}
		out[code] = strings.TrimSpace(line[idx+1:])
	}
	return out
}

func (s *Server) setMOTD(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Message string `json:"message"`
		Locale  string `json:"locale"`
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
	msg := sanitizeMailText(req.Message, 255)
	if msg == "" {
		Fail(c, http.StatusBadRequest, "bad_request", "message required")
		return
	}
	locale := normalizeMotdLocale(req.Locale, i18n.FromRequest(c))
	if locale == "" {
		Fail(c, http.StatusBadRequest, "bad_request", "invalid locale; use enUS, zhCN, ...")
		return
	}
	// AC: .server set motd [realmId] <locale> <motd...>
	cmd := "server set motd " + locale + " " + msg
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result, "locale": locale})
}

var motdLocales = map[string]bool{
	"enUS": true, "koKR": true, "frFR": true, "deDE": true,
	"zhCN": true, "zhTW": true, "zhWE": true, // zhWE kept for AC typo compatibility
	"esES": true, "esMX": true, "ruRU": true,
}

func normalizeMotdLocale(raw string, ui i18n.Locale) string {
	loc := strings.TrimSpace(raw)
	if loc == "" {
		if ui == i18n.EN {
			return "enUS"
		}
		return "zhCN"
	}
	// Accept UI-style tags.
	switch strings.ToLower(loc) {
	case "en", "en-us", "en_us":
		loc = "enUS"
	case "zh", "zh-cn", "zh_cn":
		loc = "zhCN"
	case "zh-tw", "zh_tw", "zh-hk":
		loc = "zhTW"
	}
	if motdLocales[loc] {
		return loc
	}
	// Case-insensitive match on known codes.
	for code := range motdLocales {
		if strings.EqualFold(code, loc) {
			return code
		}
	}
	return ""
}

func sanitizeMailText(s string, max int) string {
	s = strings.TrimSpace(s)
	s = strings.ReplaceAll(s, "\"", "'")
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", " ")
	if max > 0 && len(s) > max {
		s = s[:max]
	}
	return s
}

func normalizeMoney(raw string) (string, error) {
	money := strings.TrimSpace(strings.ToLower(raw))
	if money == "" || !reMoney.MatchString(money) || !strings.ContainsAny(money, "0123456789") {
		return "", fmt.Errorf("money must look like 1g2s3c")
	}
	return money, nil
}
