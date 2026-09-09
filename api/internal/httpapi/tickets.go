package httpapi

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (s *Server) listTickets(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	openOnly := c.Query("open") != "0"
	onlineOnly := c.Query("online") == "1" || strings.EqualFold(c.Query("online"), "true")
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	where := "WHERE 1=1"
	args := []any{}
	if openOnly {
		where += " AND t.completed = 0 AND t.closedBy = 0"
	}
	if onlineOnly {
		where += " AND c.online = 1"
	}

	q := `
SELECT t.id, t.playerGuid, COALESCE(t.name,''), COALESCE(t.description,''), t.createTime,
       t.mapId, t.posX, t.posY, t.posZ, t.lastModifiedTime, t.closedBy, t.assignedTo,
       COALESCE(t.comment,''), COALESCE(t.response,''), t.completed, t.escalated, t.viewed,
       COALESCE(c.online, 0)
FROM gm_ticket t
LEFT JOIN characters c ON c.guid = t.playerGuid
` + where + `
ORDER BY t.lastModifiedTime DESC
LIMIT ?`
	args = append(args, limit)

	rows, err := rt.DB.Characters.QueryContext(c.Request.Context(), q, args...)
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	defer rows.Close()

	items := []gin.H{}
	for rows.Next() {
		var (
			id, playerGuid, createTime, mapID, lastMod, closedBy, assignedTo uint32
			name, desc, comment, response                                    string
			posX, posY, posZ                                                 float32
			completed, escalated, viewed, online                             int
		)
		if err := rows.Scan(
			&id, &playerGuid, &name, &desc, &createTime, &mapID, &posX, &posY, &posZ, &lastMod,
			&closedBy, &assignedTo, &comment, &response, &completed, &escalated, &viewed, &online,
		); err != nil {
			Fail(c, http.StatusInternalServerError, "mysql_error", err.Error())
			return
		}
		items = append(items, gin.H{
			"id": id, "player_guid": playerGuid, "name": name, "description": desc,
			"create_time": createTime, "map_id": mapID,
			"pos_x": posX, "pos_y": posY, "pos_z": posZ,
			"last_modified_time": lastMod, "closed_by": closedBy, "assigned_to": assignedTo,
			"comment": comment, "response": response,
			"completed": completed, "escalated": escalated, "viewed": viewed, "online": online,
		})
	}
	JSON(c, gin.H{"items": items})
}

func (s *Server) getTicket(c *gin.Context) {
	rt, ok := s.requireTargetDB(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	q := `
SELECT t.id, t.playerGuid, COALESCE(t.name,''), COALESCE(t.description,''), t.createTime,
       t.mapId, t.posX, t.posY, t.posZ, t.lastModifiedTime, t.closedBy, t.assignedTo,
       COALESCE(t.comment,''), COALESCE(t.response,''), t.completed, t.escalated, t.viewed,
       COALESCE(c.online, 0)
FROM gm_ticket t
LEFT JOIN characters c ON c.guid = t.playerGuid
WHERE t.id = ?
LIMIT 1`
	var (
		tid, playerGuid, createTime, mapID, lastMod, closedBy, assignedTo uint32
		name, desc, comment, response                                     string
		posX, posY, posZ                                                  float32
		completed, escalated, viewed, online                              int
	)
	err = rt.DB.Characters.QueryRowContext(c.Request.Context(), q, id).Scan(
		&tid, &playerGuid, &name, &desc, &createTime, &mapID, &posX, &posY, &posZ, &lastMod,
		&closedBy, &assignedTo, &comment, &response, &completed, &escalated, &viewed, &online,
	)
	if err == sql.ErrNoRows {
		Fail(c, http.StatusNotFound, "not_found", "ticket not found")
		return
	}
	if err != nil {
		Fail(c, http.StatusBadGateway, "mysql_error", err.Error())
		return
	}
	JSON(c, gin.H{
		"id": tid, "player_guid": playerGuid, "name": name, "description": desc,
		"create_time": createTime, "map_id": mapID,
		"pos_x": posX, "pos_y": posY, "pos_z": posZ,
		"last_modified_time": lastMod, "closed_by": closedBy, "assigned_to": assignedTo,
		"comment": comment, "response": response,
		"completed": completed, "escalated": escalated, "viewed": viewed, "online": online,
	})
}

func (s *Server) ticketComment(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var req struct {
		Comment string `json:"comment"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	comment := sanitizeMailText(req.Comment, 200)
	if comment == "" {
		Fail(c, http.StatusBadRequest, "bad_request", "comment required")
		return
	}
	cmd := fmt.Sprintf("ticket comment %d %s", id, comment)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) ticketAssign(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var req struct {
		Action string `json:"action"` // assign | unassign
		GMName string `json:"gm_name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var cmd string
	switch strings.ToLower(req.Action) {
	case "unassign":
		cmd = fmt.Sprintf("ticket unassign %d", id)
	case "assign", "":
		gm, err := sanitizeCharName(req.GMName)
		if err != nil {
			Fail(c, http.StatusBadRequest, "bad_request", err.Error())
			return
		}
		cmd = fmt.Sprintf("ticket assign %d %s", id, gm)
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

func (s *Server) ticketClose(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	var req struct {
		Action  string `json:"action"` // close | complete
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
	var cmd string
	switch strings.ToLower(req.Action) {
	case "complete":
		cmd = fmt.Sprintf("ticket complete %d", id)
	case "close", "":
		cmd = fmt.Sprintf("ticket close %d", id)
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

func (s *Server) ticketDelete(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
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
	cmd := fmt.Sprintf("ticket delete %d", id)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) ticketSystem(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"` // toggle | reset
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
	var cmd string
	switch strings.ToLower(strings.TrimSpace(req.Action)) {
	case "toggle", "togglesystem":
		cmd = "ticket togglesystem"
	case "reset":
		cmd = "ticket reset"
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
