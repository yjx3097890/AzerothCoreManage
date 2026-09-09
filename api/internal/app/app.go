package app

import (
	"context"
	"fmt"
	"log"
	"time"

	"acmanage/internal/acmd"
	"acmanage/internal/audit"
	"acmanage/internal/config"
	"acmanage/internal/db"
	"acmanage/internal/dockerx"
	"acmanage/internal/soap"
)

type TargetRuntime struct {
	Cfg    *config.Target
	SOAP   *soap.Client
	DB     *db.Pools
	Docker *dockerx.Client
}

type App struct {
	Cfg    *config.Config
	Guard  *acmd.Guard
	Audit  *audit.Store
	byID   map[string]*TargetRuntime
}

func New(cfg *config.Config, auditPath string) (*App, error) {
	store, err := audit.Open(auditPath)
	if err != nil {
		return nil, fmt.Errorf("audit: %w", err)
	}
	a := &App{
		Cfg:   cfg,
		Guard: acmd.New(cfg.SOAP.Allow, cfg.SOAPDeny),
		Audit: store,
		byID:  map[string]*TargetRuntime{},
	}
	timeout := time.Duration(cfg.SOAP.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	for i := range cfg.Targets {
		t := &cfg.Targets[i]
		rt := &TargetRuntime{Cfg: t}
		rt.SOAP = soap.New(t.SOAP.Host, t.SOAP.Port, t.SOAP.Username, t.SOAP.Password, timeout)

		pools, err := db.Open(t.MySQL)
		if err != nil {
			log.Printf("target %s mysql: %v (will retry via health)", t.ID, err)
		} else {
			rt.DB = pools
		}

		if t.Docker.Enabled {
			dc, err := dockerx.New(t.Docker.Host, t.Docker.Containers)
			if err != nil {
				log.Printf("target %s docker: %v", t.ID, err)
			} else {
				rt.Docker = dc
			}
		}
		a.byID[t.ID] = rt
	}
	return a, nil
}

func (a *App) Close() {
	for _, rt := range a.byID {
		if rt.DB != nil {
			rt.DB.Close()
		}
		if rt.Docker != nil {
			_ = rt.Docker.Close()
		}
	}
	if a.Audit != nil {
		_ = a.Audit.Close()
	}
}

func (a *App) Target(id string) (*TargetRuntime, error) {
	if id == "" {
		if len(a.Cfg.Targets) == 0 {
			return nil, fmt.Errorf("no targets")
		}
		id = a.Cfg.Targets[0].ID
	}
	rt, ok := a.byID[id]
	if !ok {
		return nil, fmt.Errorf("unknown target %q", id)
	}
	return rt, nil
}

func (a *App) EnsureMySQL(rt *TargetRuntime) error {
	if rt.DB != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := rt.DB.Ping(ctx); err == nil {
			return nil
		}
		rt.DB.Close()
		rt.DB = nil
	}
	pools, err := db.Open(rt.Cfg.MySQL)
	if err != nil {
		return err
	}
	rt.DB = pools
	return nil
}
