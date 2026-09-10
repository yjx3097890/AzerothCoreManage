package httpapi

import (
	"net/http"

	"acmanage/internal/app"
	"acmanage/internal/i18n"

	"github.com/gin-gonic/gin"
)

type envelope struct {
	OK    bool      `json:"ok"`
	Data  any       `json:"data,omitempty"`
	Error *apiError `json:"error,omitempty"`
	Task  string    `json:"task,omitempty"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Server struct {
	app *app.App
}

func New(application *app.App) *Server {
	return &Server{app: application}
}

func JSON(c *gin.Context, data any) {
	c.JSON(http.StatusOK, envelope{OK: true, Data: data})
}

func Fail(c *gin.Context, status int, code, message string) {
	setAPIError(c, code, message)
	c.JSON(status, envelope{
		OK:    false,
		Error: &apiError{Code: code, Message: message},
	})
}

func FailCode(c *gin.Context, status int, code string, args ...any) {
	Fail(c, status, code, i18n.T(i18n.FromRequest(c), code, args...))
}

func NotImplemented(c *gin.Context, task string) {
	setAPIError(c, "not_implemented", "task "+task)
	c.JSON(http.StatusNotImplemented, envelope{
		OK:   false,
		Task: task,
		Error: &apiError{
			Code:    "not_implemented",
			Message: i18n.T(i18n.FromRequest(c), "not_implemented", task),
		},
	})
}

func (s *Server) Router() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger(), corsMiddleware())

	r.GET("/api/health", s.health)

	v1 := r.Group("/api/v1")
	v1.POST("/auth/login", s.login)

	authed := v1.Group("")
	authed.Use(AuthRequired(s.app.Cfg.Panel.JWTSecret))
	{
		authed.GET("/me", s.me)
		authed.GET("/targets", s.listTargets)
		authed.GET("/audit", s.listAudit)

		authed.GET("/dashboard/overview", s.dashboardOverview)

		authed.GET("/servers", s.listServers)
		authed.POST("/servers/:name/start", RequireRole(RoleGM), s.serverAction("start"))
		authed.POST("/servers/:name/stop", RequireRole(RoleGM), s.serverAction("stop"))
		authed.POST("/servers/:name/restart", RequireRole(RoleGM), s.serverAction("restart"))
		authed.POST("/servers/lifecycle", RequireRole(RoleSuperAdmin), s.serverLifecycle)
		authed.POST("/servers/control", RequireRole(RoleSuperAdmin), s.serverControl)
		authed.GET("/servers/:name/logs", RequireRole(RoleGM), s.serverLogs)
		authed.GET("/servers/:name/stats", RequireRole(RoleGM), s.serverStats)

		authed.GET("/accounts", s.listAccounts)
		authed.POST("/accounts", RequireRole(RoleGM), s.createAccount)
		authed.POST("/accounts/:name/password", RequireRole(RoleGM), s.setAccountPassword)
		authed.POST("/accounts/:name/gmlevel", RequireRole(RoleSuperAdmin), s.setAccountGMLevel)
		authed.POST("/accounts/:name/lock", RequireRole(RoleGM), s.accountLock)
		authed.POST("/accounts/:name/addon", RequireRole(RoleGM), s.accountAddon)
		authed.POST("/accounts/:name/flags", RequireRole(RoleGM), s.accountFlags)
		authed.DELETE("/accounts/:name", RequireRole(RoleSuperAdmin), s.accountDelete)
		authed.GET("/accounts/:name/2fa", RequireRole(RoleGM), s.account2FA)
		authed.POST("/accounts/:name/2fa/disable", RequireRole(RoleSuperAdmin), s.accountDisable2FA)

		authed.GET("/characters", s.listCharacters)
		authed.GET("/characters/:name", s.getCharacter)
		authed.POST("/characters/:name/kick", RequireRole(RoleGM), s.kickCharacter)
		authed.POST("/characters/:name/teleport", RequireRole(RoleGM), s.teleportCharacter)
		authed.POST("/characters/:name/level", RequireRole(RoleGM), s.characterLevel)
		authed.POST("/characters/:name/rename", RequireRole(RoleGM), s.characterRename)
		authed.POST("/characters/:name/setname", RequireRole(RoleGM), s.characterSetName)
		authed.POST("/characters/:name/customize", RequireRole(RoleGM), s.characterCustomize)
		authed.POST("/characters/:name/changefaction", RequireRole(RoleGM), s.characterChangeFaction)
		authed.POST("/characters/:name/changerace", RequireRole(RoleGM), s.characterChangeRace)
		authed.POST("/characters/:name/changeaccount", RequireRole(RoleSuperAdmin), s.characterChangeAccount)
		authed.GET("/characters/:name/inventory", s.characterInventory)
		authed.GET("/characters/:name/extras", s.characterExtras)
		authed.GET("/characters/:name/titles", s.characterTitles)
		authed.DELETE("/characters/:name/pets/:petId", RequireRole(RoleGM), s.characterDeletePet)
		authed.POST("/characters/:name/money", RequireRole(RoleGM), s.characterMoney)
		authed.POST("/characters/:name/items", RequireRole(RoleGM), s.characterItems)
		authed.POST("/characters/:name/quests", RequireRole(RoleGM), s.characterQuest)
		authed.POST("/characters/:name/reset", RequireRole(RoleGM), s.characterReviveReset)
		authed.GET("/characters-deleted", s.listDeletedCharacters)
		authed.POST("/characters-deleted", RequireRole(RoleSuperAdmin), s.deletedCharacterAction)
		authed.GET("/teleports", s.listTeleLocations)
		authed.POST("/teleports", RequireRole(RoleGM), s.createTeleLocation)
		authed.DELETE("/teleports/:name", RequireRole(RoleGM), s.deleteTeleLocation)
		authed.GET("/catalog/items", s.catalogItems)
		authed.GET("/catalog/maps", s.catalogMaps)
		authed.GET("/catalog/areas", s.catalogAreas)

		authed.GET("/moderation/bans", s.listBans)
		authed.POST("/moderation/ban", RequireRole(RoleGM), s.moderationBan)
		authed.POST("/moderation/unban", RequireRole(RoleGM), s.moderationUnban)
		authed.POST("/moderation/mute", RequireRole(RoleGM), s.moderationMute)
		authed.POST("/moderation/unmute", RequireRole(RoleGM), s.moderationUnmute)
		authed.POST("/moderation/freeze", RequireRole(RoleGM), s.moderationFreeze)
		authed.GET("/moderation/login-logs", RequireRole(RoleGM), s.listLoginLogs)
		authed.GET("/moderation/filters", RequireRole(RoleGM), s.listNameFilters)
		authed.POST("/moderation/filters", RequireRole(RoleGM), s.mutateNameFilter)

		authed.POST("/announce", RequireRole(RoleGM), s.announce)
		authed.GET("/motd", s.getMOTD)
		authed.POST("/motd", RequireRole(RoleGM), s.setMOTD)
		authed.POST("/mail/send", RequireRole(RoleGM), s.sendMail)
		authed.POST("/mail/bulk", RequireRole(RoleGM), s.sendMailBulk)
		authed.GET("/mail", s.listMails)
		authed.DELETE("/mail/:id", RequireRole(RoleGM), s.deleteMail)
		authed.GET("/autobroadcast", s.listAutobroadcast)
		authed.POST("/autobroadcast", RequireRole(RoleGM), s.upsertAutobroadcast)
		authed.DELETE("/autobroadcast/:id", RequireRole(RoleGM), s.deleteAutobroadcast)
		authed.GET("/auctions", s.listAuctions)

		authed.GET("/tickets", s.listTickets)
		authed.GET("/tickets/:id", s.getTicket)
		authed.POST("/tickets/:id/comment", RequireRole(RoleGM), s.ticketComment)
		authed.POST("/tickets/:id/assign", RequireRole(RoleGM), s.ticketAssign)
		authed.POST("/tickets/:id/close", RequireRole(RoleGM), s.ticketClose)
		authed.DELETE("/tickets/:id", RequireRole(RoleSuperAdmin), s.ticketDelete)
		authed.POST("/tickets/system", RequireRole(RoleSuperAdmin), s.ticketSystem)

		authed.GET("/guilds", s.listGuilds)
		authed.GET("/guilds/:id", s.getGuild)
		authed.GET("/guilds/:id/bank", s.getGuildBank)
		authed.POST("/guilds/action", RequireRole(RoleGM), s.guildAction)
		authed.GET("/arena/teams", s.listArenaTeams)
		authed.GET("/arena/teams/:id", s.getArenaTeam)
		authed.POST("/arena/season", RequireRole(RoleSuperAdmin), s.arenaSeasonAction)
		authed.GET("/groups", s.listGroups)
		authed.GET("/groups/:id", s.getGroup)
		authed.GET("/disables", s.listDisables)
		authed.POST("/disables", RequireRole(RoleGM), s.disableAction)
		authed.GET("/events", s.listEvents)
		authed.POST("/events", RequireRole(RoleGM), s.eventAction)
		authed.POST("/reload", RequireRole(RoleGM), s.reloadTables)

		authed.GET("/playerbots/overview", s.playerbotsOverview)
		authed.GET("/playerbots/stats", s.playerbotsStats)
		authed.GET("/playerbots/online", s.playerbotsOnline)
		authed.POST("/playerbots/rndbot/:action", RequireRole(RoleGM), s.playerbotsRndbotAction)
		authed.GET("/playerbots/config", s.playerbotsConfig)
		authed.PUT("/playerbots/config", RequireRole(RoleSuperAdmin), s.playerbotsConfigUpdate)
		authed.POST("/playerbots/bots", RequireRole(RoleGM), s.playerbotsBots)
		authed.POST("/playerbots/pmon", RequireRole(RoleGM), s.playerbotsPmon)
		authed.POST("/playerbots/account", RequireRole(RoleGM), s.playerbotsAccount)
		authed.GET("/playerbots/guilds", s.playerbotsGuilds)

		authed.GET("/config/files", RequireRole(RoleSuperAdmin), s.listConfigFiles)
		authed.GET("/config/files/:id", RequireRole(RoleSuperAdmin), s.getConfigFile)
		authed.PUT("/config/files/:id", RequireRole(RoleSuperAdmin), s.putConfigFile)
		authed.POST("/backup", RequireRole(RoleSuperAdmin), s.createBackup)
		authed.GET("/sql", RequireRole(RoleSuperAdmin), s.sqlBrowser)
		authed.POST("/soap/exec", RequireRole(RoleSuperAdmin), s.soapExec)

		// P2-A module catalog / inventory / evaluate
		authed.GET("/modules/catalog", s.listModulesCatalog)
		authed.GET("/modules/installed", s.listModulesInstalled)
		authed.GET("/modules/registry", s.listModulesRegistry)
		authed.POST("/modules/registry", RequireRole(RoleSuperAdmin), s.postModulesRegistry)
		authed.DELETE("/modules/registry/:id", RequireRole(RoleSuperAdmin), s.deleteModulesRegistry)
		authed.GET("/modules/:id", s.getModule)
		authed.POST("/modules/:id/evaluate", RequireRole(RoleGM), s.postModuleEvaluate)
		authed.GET("/modules/:id/evaluate", RequireRole(RoleGM), s.getModuleEvaluate)
		authed.GET("/modules/:id/issues", RequireRole(RoleGM), s.listModuleIssues)
		authed.GET("/modules/:id/conf", RequireRole(RoleSuperAdmin), s.getModuleConf)
		authed.PUT("/modules/:id/conf", RequireRole(RoleSuperAdmin), s.putModuleConf)
	}

	// WebSocket auth is handled inside the handler (token query / header).
	r.GET("/api/v1/servers/:name/logs/ws", s.serverLogsWS)

	return r
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			origin = "*"
		}
		c.Header("Access-Control-Allow-Origin", origin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Target-Id, X-Locale, Accept-Language")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func stub(task string) gin.HandlerFunc {
	return func(c *gin.Context) {
		NotImplemented(c, task)
	}
}
