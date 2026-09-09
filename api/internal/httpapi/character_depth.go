package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (s *Server) characterChangeAccount(c *gin.Context) {
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
		Account string `json:"account"`
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
	account, err := sanitizeAccountName(req.Account)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	// AC: .character changeaccount $NewAccountName $Name
	cmd := fmt.Sprintf("character changeaccount %s %s", account, name)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) characterExtras(c *gin.Context) {
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
	err = rt.DB.Characters.QueryRowContext(ctx,
		`SELECT guid, online FROM characters WHERE name = ? LIMIT 1`, name,
	).Scan(&guid, &online)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "character not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}

	reps := []gin.H{}
	if rows, err := rt.DB.Characters.QueryContext(ctx,
		`SELECT faction, standing, flags FROM character_reputation WHERE guid = ? ORDER BY faction LIMIT 500`, guid); err == nil {
		defer rows.Close()
		for rows.Next() {
			var faction uint16
			var standing int32
			var flags uint16
			if err := rows.Scan(&faction, &standing, &flags); err != nil {
				break
			}
			reps = append(reps, gin.H{"faction": faction, "standing": standing, "flags": flags})
		}
	}

	achs := []gin.H{}
	if rows, err := rt.DB.Characters.QueryContext(ctx,
		`SELECT achievement, date FROM character_achievement WHERE guid = ? ORDER BY date DESC LIMIT 200`, guid); err == nil {
		defer rows.Close()
		for rows.Next() {
			var ach uint32
			var date int64
			if err := rows.Scan(&ach, &date); err != nil {
				break
			}
			achs = append(achs, gin.H{"achievement": ach, "date": unixOrZero(date)})
		}
	}

	pets := []gin.H{}
	if rows, err := rt.DB.Characters.QueryContext(ctx, `
SELECT id, entry, modelid, level, exp, slot, COALESCE(name,''), curhealth, curmana, CreatedBySpell, PetType
FROM character_pet WHERE owner = ? ORDER BY slot, id`, guid); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, entry, model, level, exp, slot, health, mana, spell uint32
			var petType uint8
			var pname string
			if err := rows.Scan(&id, &entry, &model, &level, &exp, &slot, &pname, &health, &mana, &spell, &petType); err != nil {
				break
			}
			pets = append(pets, gin.H{
				"id": id, "entry": entry, "modelid": model, "level": level, "exp": exp,
				"slot": slot, "name": pname, "curhealth": health, "curmana": mana,
				"created_by_spell": spell, "pet_type": petType,
			})
		}
	}

	JSON(c, gin.H{
		"character": name, "guid": guid, "online": online,
		"reputation": reps, "achievements": achs, "pets": pets,
		"note": "titles: use SOAP character titles; setskill/learn need in-world selected player",
	})
}

func (s *Server) characterTitles(c *gin.Context) {
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
	cmd := "character titles " + name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) characterDeletePet(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	name, err := sanitizeCharName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	petID, err := strconv.Atoi(c.Param("petId"))
	if err != nil || petID <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var req struct {
		Confirm bool `json:"confirm"`
	}
	_ = c.ShouldBindJSON(&req)
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	ctx := c.Request.Context()
	var guid uint32
	var online int
	err = rt.DB.Characters.QueryRowContext(ctx,
		`SELECT guid, online FROM characters WHERE name = ? LIMIT 1`, name,
	).Scan(&guid, &online)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "character not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	if online != 0 {
		Fail(c, http.StatusConflict, "character_online", "refuse pet delete while online")
		return
	}
	res, err := rt.DB.Characters.ExecContext(ctx,
		`DELETE FROM character_pet WHERE id = ? AND owner = ?`, petID, guid)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		Fail(c, http.StatusNotFound, "not_found", "pet not found")
		return
	}
	_, _ = rt.DB.Characters.ExecContext(ctx, `DELETE FROM character_pet_declinedname WHERE id = ?`, petID)
	JSON(c, gin.H{"deleted_pet": petID, "character": name})
}

func (s *Server) listDeletedCharacters(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	authDB := quoteIdent(rt.Cfg.MySQL.AuthDB)
	where := "WHERE c.deleteInfos_Account IS NOT NULL"
	args := []any{}
	if q != "" {
		where += " AND (c.deleteInfos_Name LIKE ? OR CAST(c.guid AS CHAR) = ?)"
		args = append(args, "%"+q+"%", q)
	}
	args = append(args, limit)
	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT c.guid, COALESCE(c.deleteInfos_Name,''), c.deleteInfos_Account, COALESCE(a.username,''), c.deleteDate
FROM characters c
LEFT JOIN `+authDB+`.account a ON a.id = c.deleteInfos_Account
`+where+`
ORDER BY c.deleteDate DESC
LIMIT ?`, args...)
	if err != nil {
		// Fallback: some cores use character_deleted table
		rows2, err2 := rt.DB.Characters.QueryContext(c.Request.Context(), `
SELECT guid, charname, account, COALESCE(accountname,''), deleteDate
FROM character_deleted
ORDER BY deleteDate DESC
LIMIT ?`, limit)
		if err2 != nil {
			// Last resort: SOAP list (text) when schema differs
			Fail(c, http.StatusBadGateway, "mysql_error", err.Error()+"; "+err2.Error())
			return
		}
		defer rows2.Close()
		items := []gin.H{}
		for rows2.Next() {
			var guid, account uint32
			var name, accountName string
			var date int64
			if err := rows2.Scan(&guid, &name, &account, &accountName, &date); err != nil {
				Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
				return
			}
			items = append(items, gin.H{
				"guid": guid, "name": name, "account_id": account, "account": accountName,
				"delete_date": unixOrZero(date),
			})
		}
		JSON(c, gin.H{"items": items, "source": "character_deleted"})
		return
	}
	defer rows.Close()
	items := []gin.H{}
	for rows.Next() {
		var guid, account uint32
		var name, accountName string
		var date int64
		if err := rows.Scan(&guid, &name, &account, &accountName, &date); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"guid": guid, "name": name, "account_id": account, "account": accountName,
			"delete_date": unixOrZero(date),
		})
	}
	JSON(c, gin.H{"items": items, "source": "characters.deleteInfos"})
}

func (s *Server) deletedCharacterAction(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action     string `json:"action"` // restore | delete | purge
		GUID       int    `json:"guid"`
		Name       string `json:"name"`
		NewName    string `json:"new_name"`
		NewAccount string `json:"new_account"`
		KeepDays   int    `json:"keep_days"`
		Confirm    bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	needle := strings.TrimSpace(req.Name)
	if req.GUID > 0 {
		needle = strconv.Itoa(req.GUID)
	}
	var cmd string
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "list":
		if needle == "" {
			cmd = "character deleted list"
		} else {
			cmd = "character deleted list " + needle
		}
	case "restore":
		if needle == "" {
			Fail(c, http.StatusBadRequest, "bad_request", "guid or name required")
			return
		}
		cmd = "character deleted restore " + needle
		if nn := strings.TrimSpace(req.NewName); nn != "" {
			if _, err := sanitizeCharName(nn); err != nil {
				Fail(c, http.StatusBadRequest, "bad_request", err.Error())
				return
			}
			cmd += " " + nn
		}
		if na := strings.TrimSpace(req.NewAccount); na != "" {
			acc, err := sanitizeAccountName(na)
			if err != nil {
				Fail(c, http.StatusBadRequest, "bad_request", err.Error())
				return
			}
			cmd += " " + acc
		}
	case "delete", "erase":
		if needle == "" {
			Fail(c, http.StatusBadRequest, "bad_request", "guid or name required")
			return
		}
		cmd = "character deleted delete " + needle
	case "purge":
		if req.KeepDays > 0 {
			cmd = fmt.Sprintf("character deleted purge %d", req.KeepDays)
		} else {
			cmd = "character deleted purge"
		}
	default:
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}
