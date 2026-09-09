package main

import (
	"flag"
	"log"
	"net/http"
	"path/filepath"

	"acmanage/internal/app"
	"acmanage/internal/applog"
	"acmanage/internal/config"
	"acmanage/internal/httpapi"

	"github.com/gin-gonic/gin"
)

func main() {
	cfgPath := flag.String("config", "../config.yaml", "path to config yaml")
	auditPath := flag.String("audit-db", "../data/audit.db", "sqlite path for audit log")
	logDir := flag.String("log-dir", "logs", "directory for rolling log files (app.log / error.log)")
	flag.Parse()

	access, cleanup := applog.Setup(filepath.Clean(*logDir))
	defer cleanup()
	gin.DefaultWriter = access
	gin.DefaultErrorWriter = applog.ErrorWriter()

	cfg, err := config.Load(*cfgPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	application, err := app.New(cfg, filepath.Clean(*auditPath))
	if err != nil {
		log.Fatalf("bootstrap: %v", err)
	}
	defer application.Close()

	srv := httpapi.New(application)
	log.Printf("acmanage api listening on %s (log-dir=%s)", cfg.Panel.Listen, filepath.Clean(*logDir))
	if err := http.ListenAndServe(cfg.Panel.Listen, srv.Router()); err != nil {
		log.Fatal(err)
	}
}
