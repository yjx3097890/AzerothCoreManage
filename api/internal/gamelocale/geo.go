package gamelocale

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"sync"

	"acmanage/internal/i18n"
)

//go:embed map_zhCN.json
var mapZHCNJSON []byte

//go:embed area_zhCN.json
var areaZHCNJSON []byte

//go:embed map_enUS.json
var mapENUSJSON []byte

//go:embed area_enUS.json
var areaENUSJSON []byte

var (
	geoOnce sync.Once
	mapsZH  map[int]string
	areasZH map[int]string
	mapsEN  map[int]string
	areasEN map[int]string
	mapIDs  []int
	areaIDs []int
)

func loadGeo() {
	geoOnce.Do(func() {
		mapsZH = decodeIDStringMap(mapZHCNJSON)
		areasZH = decodeIDStringMap(areaZHCNJSON)
		mapsEN = decodeIDStringMap(mapENUSJSON)
		areasEN = decodeIDStringMap(areaENUSJSON)
		// Prefer ZH id set for stable ordering (covers live client extract).
		mapIDs = sortedKeys(mapsZH)
		if len(mapIDs) == 0 {
			mapIDs = sortedKeys(mapsEN)
		}
		areaIDs = sortedKeys(areasZH)
		if len(areaIDs) == 0 {
			areaIDs = sortedKeys(areasEN)
		}
	})
}

func decodeIDStringMap(raw []byte) map[int]string {
	tmp := map[string]string{}
	_ = json.Unmarshal(raw, &tmp)
	out := make(map[int]string, len(tmp))
	for k, v := range tmp {
		id, err := strconv.Atoi(k)
		if err != nil || v == "" {
			continue
		}
		out[id] = v
	}
	return out
}

func sortedKeys(m map[int]string) []int {
	keys := make([]int, 0, len(m))
	for id := range m {
		keys = append(keys, id)
	}
	sort.Ints(keys)
	return keys
}

func MapNameZH(id int) string {
	loadGeo()
	return mapsZH[id]
}

func AreaNameZH(id int) string {
	loadGeo()
	return areasZH[id]
}

func MapName(id int, loc i18n.Locale) string {
	loadGeo()
	if loc == i18n.EN {
		if n := mapsEN[id]; n != "" {
			return n
		}
	}
	if n := mapsZH[id]; n != "" {
		return n
	}
	return mapsEN[id]
}

func AreaName(id int, loc i18n.Locale) string {
	loadGeo()
	if loc == i18n.EN {
		if n := areasEN[id]; n != "" {
			return n
		}
	}
	if n := areasZH[id]; n != "" {
		return n
	}
	return areasEN[id]
}

type NamedID struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	NameEN string `json:"name_en,omitempty"`
	NameZH string `json:"name_zh,omitempty"`
}

func matchIDOrNames(id int, names []string, q string) bool {
	if q == "" {
		return true
	}
	if strconv.Itoa(id) == q || strings.Contains(strconv.Itoa(id), q) {
		return true
	}
	ql := strings.ToLower(q)
	for _, name := range names {
		if name != "" && strings.Contains(strings.ToLower(name), ql) {
			return true
		}
	}
	return false
}

// SearchMaps filters embedded map names by locale (also matches the other language).
func SearchMaps(q string, limit int, loc i18n.Locale) []NamedID {
	loadGeo()
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q = strings.TrimSpace(q)
	out := make([]NamedID, 0, limit)
	for _, id := range mapIDs {
		zh, en := mapsZH[id], mapsEN[id]
		if !matchIDOrNames(id, []string{zh, en}, q) {
			continue
		}
		name := zh
		if loc == i18n.EN {
			if en != "" {
				name = en
			}
		} else if name == "" {
			name = en
		}
		out = append(out, NamedID{ID: id, Name: name, NameEN: en, NameZH: zh})
		if len(out) >= limit {
			break
		}
	}
	return out
}

// SearchAreas filters embedded area/zone names by locale (also matches the other language).
func SearchAreas(q string, limit int, loc i18n.Locale) []NamedID {
	loadGeo()
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q = strings.TrimSpace(q)
	out := make([]NamedID, 0, min(limit, len(areaIDs)))
	for _, id := range areaIDs {
		zh, en := areasZH[id], areasEN[id]
		if !matchIDOrNames(id, []string{zh, en}, q) {
			continue
		}
		name := zh
		if loc == i18n.EN {
			if en != "" {
				name = en
			}
		} else if name == "" {
			name = en
		}
		out = append(out, NamedID{ID: id, Name: name, NameEN: en, NameZH: zh})
		if len(out) >= limit {
			break
		}
	}
	return out
}

// MapNameMatches reports whether any localized map name contains q (for tele search).
func MapNameMatches(mapID int, q string) bool {
	if q == "" {
		return true
	}
	loadGeo()
	ql := strings.ToLower(q)
	for _, name := range []string{mapsZH[mapID], mapsEN[mapID]} {
		if name != "" && strings.Contains(strings.ToLower(name), ql) {
			return true
		}
	}
	return false
}
