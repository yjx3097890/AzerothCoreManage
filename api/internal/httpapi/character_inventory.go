package httpapi

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

var equipSlotNames = map[uint8]string{
	0: "head", 1: "neck", 2: "shoulders", 3: "shirt", 4: "chest",
	5: "waist", 6: "legs", 7: "feet", 8: "wrists", 9: "hands",
	10: "finger1", 11: "finger2", 12: "trinket1", 13: "trinket2",
	14: "back", 15: "mainhand", 16: "offhand", 17: "ranged", 18: "tabard",
}

func (s *Server) characterInventory(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	ctx := c.Request.Context()
	var guid uint32
	var online int
	var money uint32
	err = rt.DB.Characters.QueryRowContext(ctx,
		`SELECT guid, online, money FROM characters WHERE name = ? LIMIT 1`, name,
	).Scan(&guid, &online, &money)
	if err != nil {
		Fail(c, http.StatusNotFound, "not_found", "character not found")
		return
	}

	worldDB := quoteIdent(rt.Cfg.MySQL.WorldDB)
	q := `
SELECT ci.bag, ci.slot, ci.item, ii.itemEntry, ii.count, ii.durability,
       ` + itemNameExpr("it", "itl") + `
FROM character_inventory ci
JOIN item_instance ii ON ii.guid = ci.item
LEFT JOIN ` + worldDB + `.item_template it ON it.entry = ii.itemEntry
` + itemLocaleJoin(worldDB, "it", "itl") + `
WHERE ci.guid = ?
ORDER BY ci.bag, ci.slot`

	rows, err := rt.DB.Characters.QueryContext(ctx, q, guid)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	equipment := []gin.H{}
	backpack := []gin.H{}
	bags := []gin.H{}
	other := []gin.H{}

	for rows.Next() {
		var bag, itemGUID, entry, count uint32
		var slot uint8
		var durability int
		var itemName string
		if err := rows.Scan(&bag, &slot, &itemGUID, &entry, &count, &durability, &itemName); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		row := gin.H{
			"bag": bag, "slot": slot, "item_guid": itemGUID,
			"item_entry": entry, "count": count, "durability": durability, "name": itemName,
		}
		if bag == 0 && slot <= 18 {
			row["slot_name"] = equipSlotNames[slot]
			equipment = append(equipment, row)
			continue
		}
		if bag == 0 && slot >= 19 && slot <= 22 {
			row["slot_name"] = "bag_slot"
			bags = append(bags, row)
			continue
		}
		if bag == 0 && slot >= 23 && slot <= 38 {
			row["slot_name"] = "backpack"
			backpack = append(backpack, row)
			continue
		}
		other = append(other, row)
	}

	JSON(c, gin.H{
		"character":  name,
		"guid":       guid,
		"online":     online,
		"money":      money,
		"equipment":  equipment,
		"bag_slots":  bags,
		"backpack":   backpack,
		"other":      other,
		"note":       "writes use SOAP send money / send items (mailbox); online bag inject is not used",
	})
}

func (s *Server) characterMoney(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Money   string `json:"money"`
		Subject string `json:"subject"`
		Body    string `json:"body"`
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
	money, err := normalizeMoney(req.Money)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	subject := sanitizeMailText(req.Subject, 64)
	body := sanitizeMailText(req.Body, 200)
	if subject == "" {
		subject = "GM"
	}
	if body == "" {
		body = "panel"
	}
	cmd := fmt.Sprintf("send money %s \"%s\" \"%s\" %s", name, subject, body, money)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) characterItems(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Action  string `json:"action"` // send | add
		ItemID  int    `json:"item_id"`
		Count   int    `json:"count"`
		Subject string `json:"subject"`
		Body    string `json:"body"`
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
	if req.ItemID <= 0 {
		Fail(c, http.StatusBadRequest, "bad_request", "item_id required")
		return
	}
	count := req.Count
	if count == 0 {
		count = 1
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if action == "" {
		action = "send"
	}

	var cmd string
	switch action {
	case "send":
		if count < 0 {
			Fail(c, http.StatusBadRequest, "bad_request", "send count must be positive")
			return
		}
		subject := sanitizeMailText(req.Subject, 64)
		body := sanitizeMailText(req.Body, 200)
		if subject == "" {
			subject = "GM"
		}
		if body == "" {
			body = "panel"
		}
		cmd = fmt.Sprintf("send items %s \"%s\" \"%s\" %d:%d", name, subject, body, req.ItemID, count)
	case "add":
		// Requires the character online as SOAP command target context is limited;
		// AzerothCore still accepts: additem works on selected player — prefer send for reliability.
		// Playerbots / AC SOAP often needs the player online; we still expose for GM experiments.
		cmd = fmt.Sprintf("additem %d %d", req.ItemID, count)
		_ = name // name cannot be passed to classic additem; document in response
	default:
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}

	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	out := gin.H{"command": cmd, "result": result, "character": name}
	if action == "add" {
		out["warning"] = "additem targets the currently selected player in-world; prefer action=send (mailbox)"
	}
	JSON(c, out)
}
