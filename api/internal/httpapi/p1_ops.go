package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func (s *Server) serverStats(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	if !rt.Cfg.Docker.Enabled || rt.Docker == nil {
		Fail(c, http.StatusBadRequest, "docker_disabled", "docker disabled for this target")
		return
	}
	ctx := c.Request.Context()
	stats, err := rt.Docker.Stats(ctx, c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadGateway, "docker_error", err.Error())
		return
	}
	JSON(c, stats)
}

func (s *Server) serverControl(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Action  string `json:"action"`
		Value   string `json:"value"`
		Delay   int    `json:"delay"`
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
	if req.Delay <= 0 {
		req.Delay = 30
	}
	var cmd string
	switch strings.ToLower(req.Action) {
	case "idlerestart":
		cmd = "server idlerestart " + strconv.Itoa(req.Delay)
	case "idleshutdown":
		cmd = "server idleshutdown " + strconv.Itoa(req.Delay)
	case "set_closed":
		v := strings.ToLower(strings.TrimSpace(req.Value))
		if v != "on" && v != "off" {
			Fail(c, http.StatusBadRequest, "bad_request", "value must be on|off")
			return
		}
		cmd = "server set closed " + v
	case "set_security":
		level, err := strconv.Atoi(strings.TrimSpace(req.Value))
		if err != nil || level < 0 || level > 3 {
			Fail(c, http.StatusBadRequest, "bad_request", "security level 0-3")
			return
		}
		cmd = "server set security " + strconv.Itoa(level)
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

func (s *Server) accountLock(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	user, err := sanitizeAccountName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Locked  *int   `json:"locked"` // 0/1
		Country string `json:"country"`
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
	if req.Country != "" {
		cc := strings.ToUpper(strings.TrimSpace(req.Country))
		if len(cc) != 2 {
			Fail(c, http.StatusBadRequest, "bad_request", "country must be 2 letters")
			return
		}
		cmd = fmt.Sprintf("account lock country %s %s", user, cc)
	} else if req.Locked != nil {
		if *req.Locked == 1 {
			cmd = "account lock ip on " + user
		} else {
			cmd = "account lock ip off " + user
		}
	} else {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) accountAddon(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	user, err := sanitizeAccountName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Addon   int  `json:"addon"`
		Confirm bool `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	if !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	if req.Addon < 0 || req.Addon > 2 {
		Fail(c, http.StatusBadRequest, "bad_request", "addon 0-2")
		return
	}
	cmd := fmt.Sprintf("account set addon %s %d", user, req.Addon)
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) accountFlags(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	user, err := sanitizeAccountName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Action  string `json:"action"` // add|remove|list
		Flag    string `json:"flag"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	var cmd string
	switch action {
	case "list":
		cmd = "account flag list " + user
	case "add", "remove":
		if !req.Confirm {
			Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
			return
		}
		flag := strings.TrimSpace(req.Flag)
		if flag == "" || strings.ContainsAny(flag, " \t\n\"'`") {
			Fail(c, http.StatusBadRequest, "bad_request", "invalid flag")
			return
		}
		cmd = fmt.Sprintf("account flag %s %s %s", action, user, flag)
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

func (s *Server) accountDelete(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	user, err := sanitizeAccountName(c.Param("name"))
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var req struct {
		Confirm bool   `json:"confirm"`
		Phrase  string `json:"phrase"`
	}
	_ = c.ShouldBindJSON(&req)
	if !req.Confirm || req.Phrase != user {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm with matching username phrase")
		return
	}
	cmd := "account delete " + user
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result})
}

func (s *Server) characterQuest(c *gin.Context) {
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
		Action  string `json:"action"` // add|complete|remove|status
		QuestID int    `json:"quest_id"`
		Confirm bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	action := strings.ToLower(strings.TrimSpace(req.Action))
	if req.QuestID <= 0 && action != "status" {
		Fail(c, http.StatusBadRequest, "bad_request", "quest_id required")
		return
	}
	if action != "status" && !req.Confirm {
		Fail(c, http.StatusBadRequest, "confirm_required", "confirm required")
		return
	}
	var cmd string
	switch action {
	case "add":
		cmd = fmt.Sprintf("quest add %d", req.QuestID)
	case "complete":
		cmd = fmt.Sprintf("quest complete %d", req.QuestID)
	case "remove":
		cmd = fmt.Sprintf("quest remove %d", req.QuestID)
	case "status":
		cmd = fmt.Sprintf("quest status %d", req.QuestID)
	default:
		FailCode(c, http.StatusBadRequest, "bad_request")
		return
	}
	// Prefer name-targeted variants when available; AC often needs selected player.
	// send via announce style: many panels use "character quest ..." — keep classic quest * and note.
	_ = name
	result, err := s.execSOAP(c, rt, cmd)
	if err != nil {
		return
	}
	JSON(c, gin.H{"command": cmd, "result": result, "character": name, "warning": "quest commands target selected in-world player; ensure character is selected/online"})
}

func (s *Server) characterReviveReset(c *gin.Context) {
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
		Action  string `json:"action"` // revive|reset_talents|reset_spells|reset_honor|reset_level|reset_stats|reset_all
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
	case "revive":
		cmd = "revive " + name
	case "reset_talents":
		cmd = "reset talents " + name
	case "reset_spells":
		cmd = "reset spells " + name
	case "reset_honor":
		cmd = "reset honor " + name
	case "reset_level":
		cmd = "reset level " + name
	case "reset_stats":
		cmd = "reset stats " + name
	case "reset_all":
		cmd = "reset all " + name
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

func (s *Server) moderationFreeze(c *gin.Context) {
	rt, err := s.app.Target(TargetID(c))
	if err != nil {
		FailCode(c, http.StatusBadRequest, "bad_target")
		return
	}
	var req struct {
		Name    string `json:"name"`
		Action  string `json:"action"` // freeze|unfreeze
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
	name, err := sanitizeCharName(req.Name)
	if err != nil {
		Fail(c, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var cmd string
	switch strings.ToLower(req.Action) {
	case "freeze", "":
		cmd = "freeze " + name
	case "unfreeze":
		cmd = "unfreeze " + name
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
