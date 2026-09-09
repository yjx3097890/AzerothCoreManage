package gamelocale

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"acmanage/internal/i18n"
)

//go:embed game_event_zhCN.json
var gameEventZHCNJSON []byte

type EventNames struct {
	EN      string `json:"en"`
	ZH      string `json:"zh"`
	Holiday int    `json:"holiday"`
}

type ActiveEvent struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	NameEN string `json:"name_en"`
	Active bool   `json:"active"`
	Raw    string `json:"raw"`
}

var (
	loadOnce   sync.Once
	eventNames map[int]EventNames
)

var activeLineRE = regexp.MustCompile(`(?i)^\s*(\d+)\s*-\s*(.+?)\s*\[(active|inactive|disabled)?\]\s*$`)
var activeLooseRE = regexp.MustCompile(`(?i)^\s*(\d+)\s*-\s*(.+)$`)

func loadEventNames() {
	loadOnce.Do(func() {
		raw := map[string]EventNames{}
		_ = json.Unmarshal(gameEventZHCNJSON, &raw)
		eventNames = make(map[int]EventNames, len(raw))
		for k, v := range raw {
			id, err := strconv.Atoi(k)
			if err != nil {
				continue
			}
			eventNames[id] = v
		}
	})
}

func NameForEvent(id int, fallbackEN string, loc i18n.Locale) (display, en string) {
	loadEventNames()
	entry, ok := eventNames[id]
	en = fallbackEN
	if ok && entry.EN != "" {
		en = entry.EN
	}
	if loc == i18n.EN {
		if en != "" {
			return en, en
		}
		return fallbackEN, fallbackEN
	}
	if ok && entry.ZH != "" {
		return entry.ZH, en
	}
	if fallbackEN != "" {
		return fallbackEN, en
	}
	if ok && entry.EN != "" {
		return entry.EN, entry.EN
	}
	return strconv.Itoa(id), en
}

// ParseActiveList turns SOAP `event activelist` output into structured rows,
// applying zh-CN names when locale is Chinese.
func ParseActiveList(raw string, loc i18n.Locale) []ActiveEvent {
	loadEventNames()
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	out := make([]ActiveEvent, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		id, enName, active, ok := parseActiveLine(line)
		if !ok {
			continue
		}
		name, en := NameForEvent(id, enName, loc)
		out = append(out, ActiveEvent{
			ID:     id,
			Name:   name,
			NameEN: en,
			Active: active,
			Raw:    line,
		})
	}
	return out
}

func parseActiveLine(line string) (id int, name string, active bool, ok bool) {
	if m := activeLineRE.FindStringSubmatch(line); len(m) == 4 {
		id, err := strconv.Atoi(m[1])
		if err != nil {
			return 0, "", false, false
		}
		name = strings.TrimSpace(m[2])
		flag := strings.ToLower(m[3])
		active = flag == "" || flag == "active"
		return id, name, active, true
	}
	if m := activeLooseRE.FindStringSubmatch(line); len(m) == 3 {
		id, err := strconv.Atoi(m[1])
		if err != nil {
			return 0, "", false, false
		}
		rest := strings.TrimSpace(m[2])
		active = true
		if i := strings.LastIndex(rest, "["); i >= 0 && strings.HasSuffix(rest, "]") {
			flag := strings.ToLower(strings.TrimSpace(rest[i+1 : len(rest)-1]))
			rest = strings.TrimSpace(rest[:i])
			active = flag == "" || flag == "active"
		}
		return id, rest, active, true
	}
	return 0, "", false, false
}
