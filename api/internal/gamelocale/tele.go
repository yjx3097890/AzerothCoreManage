package gamelocale

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"

	"acmanage/internal/i18n"
)

//go:embed game_tele_zhCN.json
var gameTeleZHCNJSON []byte

var (
	teleOnce sync.Once
	teleZH   map[string]string // English game_tele.name -> zhCN
)

func loadTele() {
	teleOnce.Do(func() {
		raw := map[string]string{}
		_ = json.Unmarshal(gameTeleZHCNJSON, &raw)
		teleZH = make(map[string]string, len(raw)*2)
		for en, zh := range raw {
			if en == "" || zh == "" {
				continue
			}
			teleZH[en] = zh
			teleZH[strings.ToLower(en)] = zh
		}
	})
}

// TeleNameZH returns the Chinese label for a game_tele English name, if known.
func TeleNameZH(enName string) string {
	loadTele()
	if zh := teleZH[enName]; zh != "" {
		return zh
	}
	return teleZH[strings.ToLower(enName)]
}

// TeleDisplayName returns the locale-facing teleport label (ZH when available).
func TeleDisplayName(enName string, loc i18n.Locale) string {
	if loc != i18n.EN {
		if zh := TeleNameZH(enName); zh != "" {
			return zh
		}
	}
	return enName
}

// TeleNameMatches reports whether q matches the English and/or Chinese tele name.
func TeleNameMatches(enName, q string) bool {
	if q == "" {
		return true
	}
	ql := strings.ToLower(strings.TrimSpace(q))
	if ql == "" {
		return true
	}
	if strings.Contains(strings.ToLower(enName), ql) {
		return true
	}
	zh := TeleNameZH(enName)
	if zh == "" {
		return false
	}
	// Chinese needles are matched as-is (no lowercasing).
	if strings.Contains(zh, strings.TrimSpace(q)) {
		return true
	}
	return strings.Contains(strings.ToLower(zh), ql)
}
