package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"acmanage/internal/app"
	"acmanage/internal/i18n"
	"acmanage/internal/mybots"

	"github.com/gin-gonic/gin"
)

// character_queststatus.status (QuestStatus)
const (
	questStatusComplete   uint8 = 1
	questStatusIncomplete uint8 = 3
	questStatusFailed     uint8 = 5
)

func questStatusLabel(st uint8) string {
	switch st {
	case questStatusComplete:
		return "complete"
	case questStatusIncomplete:
		return "incomplete"
	case questStatusFailed:
		return "failed"
	default:
		return "unknown"
	}
}

func (s *Server) resolveCharacterGuid(c *gin.Context, rt *app.TargetRuntime, nameOrGUID string) (guid uint32, name string, level, race, class uint8, ok bool) {
	ctx := c.Request.Context()
	nameOrGUID = strings.TrimSpace(nameOrGUID)
	if nameOrGUID == "" {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return 0, "", 0, 0, 0, false
	}
	q := `
SELECT guid, name, level, race, class
FROM characters
WHERE name = ?`
	args := []any{nameOrGUID}
	if id, err := strconv.ParseUint(nameOrGUID, 10, 32); err == nil {
		q = `
SELECT guid, name, level, race, class
FROM characters
WHERE guid = ? OR name = ?`
		args = []any{uint32(id), nameOrGUID}
	}
	err := rt.DB.Characters.QueryRowContext(ctx, q, args...).Scan(&guid, &name, &level, &race, &class)
	if err == sql.ErrNoRows {
		FailCode(c, http.StatusNotFound, "not_found")
		return 0, "", 0, 0, 0, false
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return 0, "", 0, 0, 0, false
	}
	return guid, name, level, race, class, true
}

func loadQuestNPCEntries(ctx context.Context, world *sql.DB, questIDs []uint32) (starters, enders map[uint32]uint32) {
	starters = map[uint32]uint32{}
	enders = map[uint32]uint32{}
	if len(questIDs) == 0 || world == nil {
		return starters, enders
	}
	ph := make([]string, len(questIDs))
	args := make([]any, len(questIDs))
	for i, id := range questIDs {
		ph[i] = "?"
		args[i] = id
	}
	in := strings.Join(ph, ",")
	rows, err := world.QueryContext(ctx, `
SELECT quest, id FROM creature_queststarter WHERE quest IN (`+in+`) ORDER BY id`, args...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var quest, entry uint32
			if rows.Scan(&quest, &entry) == nil {
				if _, exists := starters[quest]; !exists {
					starters[quest] = entry
				}
			}
		}
	}
	rows2, err := world.QueryContext(ctx, `
SELECT quest, id FROM creature_questender WHERE quest IN (`+in+`) ORDER BY id`, args...)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var quest, entry uint32
			if rows2.Scan(&quest, &entry) == nil {
				if _, exists := enders[quest]; !exists {
					enders[quest] = entry
				}
			}
		}
	}
	return starters, enders
}

func (s *Server) tryLiveMyBotsQuests(c *gin.Context, charID, pathSuffix string) (payload map[string]any, used bool) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		return nil, false
	}
	mb := rt.Cfg.MyBots
	if !mb.Configured() {
		return nil, false
	}
	client := mybots.New(mb.Host, mb.Port, mb.Token, 8*time.Second)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	path := "/v1/characters/" + mybots.EscapePath(charID) + "/" + pathSuffix
	res, err := client.Do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, false
	}
	if res.Status < 200 || res.Status >= 300 {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal(res.Body, &out); err != nil {
		return nil, false
	}
	// Enrich titles from world DB locale when possible.
	preferZH := i18n.FromRequest(c) != i18n.EN
	if items, ok := out["items"].([]any); ok && len(items) > 0 {
		idSet := map[uint32]struct{}{}
		for _, it := range items {
			m, ok := it.(map[string]any)
			if !ok {
				continue
			}
			if id, ok := asInt(m["questId"]); ok && id > 0 {
				idSet[uint32(id)] = struct{}{}
			}
		}
		names := loadQuestNames(c, rt, idSet, preferZH)
		for _, it := range items {
			m, ok := it.(map[string]any)
			if !ok {
				continue
			}
			id, ok := asInt(m["questId"])
			if !ok {
				continue
			}
			if title := names[uint32(id)]; title != "" {
				m["title"] = title
			}
		}
		out["items"] = items
	}
	out["character"] = charID
	if _, ok := out["source"]; !ok {
		out["source"] = "live"
	}
	_ = rt
	return out, true
}

func (s *Server) characterQuestLog(c *gin.Context) {
	name := c.Param("name")
	if live, ok := s.tryLiveMyBotsQuests(c, name, "quests"); ok {
		JSON(c, live)
		return
	}

	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	guid, charName, _, _, _, ok := s.resolveCharacterGuid(c, rt, name)
	if !ok {
		return
	}
	ctx := c.Request.Context()
	preferZH := i18n.FromRequest(c) != i18n.EN

	rows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT quest, status
FROM character_queststatus
WHERE guid = ?
ORDER BY quest`, guid)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	type logRow struct {
		quest  uint32
		status uint8
	}
	var log []logRow
	questIDs := make([]uint32, 0)
	idSet := map[uint32]struct{}{}
	for rows.Next() {
		var r logRow
		if err := rows.Scan(&r.quest, &r.status); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		log = append(log, r)
		questIDs = append(questIDs, r.quest)
		idSet[r.quest] = struct{}{}
	}

	names := loadQuestNames(c, rt, idSet, preferZH)
	meta := loadQuestMeta(ctx, rt.DB.World, questIDs)
	starters, enders := loadQuestNPCEntries(ctx, rt.DB.World, questIDs)

	items := make([]gin.H, 0, len(log))
	for _, r := range log {
		m := meta[r.quest]
		title := names[r.quest]
		if title == "" {
			title = m.Title
		}
		item := gin.H{
			"questId":      r.quest,
			"title":        title,
			"status":       r.status,
			"status_label": questStatusLabel(r.status),
			"questLevel":   m.QuestLevel,
			"minLevel":     m.MinLevel,
			"completable":  r.status == questStatusComplete,
			"source":       "db",
		}
		if e := starters[r.quest]; e > 0 {
			item["giverEntry"] = e
		}
		if e := enders[r.quest]; e > 0 {
			item["turninEntry"] = e
		}
		items = append(items, item)
	}
	JSON(c, gin.H{"character": charName, "guid": guid, "source": "db", "note": "offline_or_unconfigured", "items": items})
}

type questMeta struct {
	Title      string
	QuestLevel int
	MinLevel   int
}

func loadQuestMeta(ctx context.Context, world *sql.DB, questIDs []uint32) map[uint32]questMeta {
	out := map[uint32]questMeta{}
	if len(questIDs) == 0 || world == nil {
		return out
	}
	ph := make([]string, len(questIDs))
	args := make([]any, len(questIDs))
	for i, id := range questIDs {
		ph[i] = "?"
		args[i] = id
	}
	rows, err := world.QueryContext(ctx, `
SELECT qt.ID, qt.LogTitle, qt.QuestLevel, qt.MinLevel
FROM quest_template qt
WHERE qt.ID IN (`+strings.Join(ph, ",")+`)`, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id uint32
		var title string
		var qLevel, minLevel int
		if rows.Scan(&id, &title, &qLevel, &minLevel) == nil {
			out[id] = questMeta{Title: title, QuestLevel: qLevel, MinLevel: minLevel}
		}
	}
	return out
}

func raceMask(race uint8) uint32 {
	if race == 0 {
		return 0
	}
	return 1 << (race - 1)
}

func classMask(class uint8) uint32 {
	if class == 0 {
		return 0
	}
	return 1 << (class - 1)
}

func (s *Server) characterQuestsAvailable(c *gin.Context) {
	name := c.Param("name")
	if live, ok := s.tryLiveMyBotsQuests(c, name, "quests/available"); ok {
		JSON(c, live)
		return
	}

	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	guid, charName, level, race, class, ok := s.resolveCharacterGuid(c, rt, name)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "80"))
	if limit <= 0 || limit > 200 {
		limit = 80
	}
	ctx := c.Request.Context()
	preferZH := i18n.FromRequest(c) != i18n.EN

	inLog := map[uint32]struct{}{}
	rows, err := rt.DB.Characters.QueryContext(ctx, `SELECT quest FROM character_queststatus WHERE guid = ?`, guid)
	if err == nil {
		for rows.Next() {
			var qid uint32
			if rows.Scan(&qid) == nil {
				inLog[qid] = struct{}{}
			}
		}
		rows.Close()
	}
	rewarded := map[uint32]struct{}{}
	rowsR, err := rt.DB.Characters.QueryContext(ctx, `SELECT quest FROM character_queststatus_rewarded WHERE guid = ?`, guid)
	if err == nil {
		for rowsR.Next() {
			var qid uint32
			if rowsR.Scan(&qid) == nil {
				rewarded[qid] = struct{}{}
			}
		}
		rowsR.Close()
	}

	// Heuristic pool: level-banded quests that have a creature starter.
	qRows, err := rt.DB.World.QueryContext(ctx, `
SELECT qt.ID, qt.LogTitle, qt.QuestLevel, qt.MinLevel, qt.AllowableRaces,
       COALESCE(qa.MaxLevel, 0), COALESCE(qa.AllowableClasses, 0),
       COALESCE(NULLIF(ql.Title,''), '') AS title_zh,
       MIN(cqs.id) AS giver_entry
FROM quest_template qt
INNER JOIN creature_queststarter cqs ON cqs.quest = qt.ID
LEFT JOIN quest_template_addon qa ON qa.ID = qt.ID
LEFT JOIN quest_template_locale ql ON ql.ID = qt.ID AND ql.locale = 'zhCN'
WHERE qt.MinLevel <= ?
  AND qt.QuestLevel >= 0
  AND (qt.QuestLevel = 0 OR qt.QuestLevel <= ? + 5)
  AND (qa.MaxLevel IS NULL OR qa.MaxLevel = 0 OR qa.MaxLevel >= ?)
GROUP BY qt.ID, qt.LogTitle, qt.QuestLevel, qt.MinLevel, qt.AllowableRaces, qa.MaxLevel, qa.AllowableClasses, title_zh
ORDER BY ABS(qt.QuestLevel - ?) ASC, qt.MinLevel DESC, qt.ID
LIMIT 500`, level, level, level, int(level))
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer qRows.Close()

	rm := raceMask(race)
	cm := classMask(class)
	type cand struct {
		id, giver                                           uint32
		title                                               string
		questLevel, minLevel                                int
		allowRaces, allowClasses, maxLevel                  uint32
		score                                               int
	}
	cands := make([]cand, 0, 128)
	questIDs := make([]uint32, 0, 128)
	for qRows.Next() {
		var row cand
		var titleEN, titleZH string
		if err := qRows.Scan(&row.id, &titleEN, &row.questLevel, &row.minLevel, &row.allowRaces, &row.maxLevel, &row.allowClasses, &titleZH, &row.giver); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		if _, ok := inLog[row.id]; ok {
			continue
		}
		if _, ok := rewarded[row.id]; ok {
			continue
		}
		if row.allowRaces != 0 && (row.allowRaces&rm) == 0 {
			continue
		}
		if row.allowClasses != 0 && (row.allowClasses&cm) == 0 {
			continue
		}
		row.title = titleEN
		if preferZH && titleZH != "" {
			row.title = titleZH
		}
		if row.questLevel > 0 {
			diff := row.questLevel - int(level)
			if diff < 0 {
				diff = -diff
			}
			row.score = diff
		} else {
			row.score = 50
		}
		cands = append(cands, row)
		questIDs = append(questIDs, row.id)
	}
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].score != cands[j].score {
			return cands[i].score < cands[j].score
		}
		return cands[i].id < cands[j].id
	})
	if len(cands) > limit {
		cands = cands[:limit]
		questIDs = questIDs[:limit]
	}
	_, enders := loadQuestNPCEntries(ctx, rt.DB.World, questIDs)

	items := make([]gin.H, 0, len(cands))
	for _, c := range cands {
		item := gin.H{
			"questId":    c.id,
			"title":      c.title,
			"questLevel": c.questLevel,
			"minLevel":   c.minLevel,
			"giverEntry": c.giver,
			"heuristic":  true,
		}
		if e := enders[c.id]; e > 0 {
			item["turninEntry"] = e
		}
		items = append(items, item)
	}
	JSON(c, gin.H{
		"character": charName,
		"guid":      guid,
		"level":     level,
		"race":      race,
		"class":     class,
		"source":    "db",
		"note":      "heuristic",
		"items":     items,
	})
}
