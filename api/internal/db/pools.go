package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"acmanage/internal/config"

	_ "github.com/go-sql-driver/mysql"
)

type Pools struct {
	Auth        *sql.DB
	Characters  *sql.DB
	World       *sql.DB
	Playerbots  *sql.DB
}

func Open(cfg config.MySQL) (*Pools, error) {
	openOne := func(name string) (*sql.DB, error) {
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4&loc=Local",
			cfg.User, cfg.Password, cfg.Host, cfg.Port, name)
		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(10)
		db.SetMaxIdleConns(5)
		db.SetConnMaxLifetime(30 * time.Minute)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := db.PingContext(ctx); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("%s: %w", name, err)
		}
		return db, nil
	}

	auth, err := openOne(cfg.AuthDB)
	if err != nil {
		return nil, err
	}
	chars, err := openOne(cfg.CharactersDB)
	if err != nil {
		_ = auth.Close()
		return nil, err
	}
	world, err := openOne(cfg.WorldDB)
	if err != nil {
		_ = auth.Close()
		_ = chars.Close()
		return nil, err
	}
	bots, err := openOne(cfg.PlayerbotsDB)
	if err != nil {
		// playerbots 库可选：连不上时置空，健康检查单独报
		bots = nil
		_ = err
	}

	return &Pools{Auth: auth, Characters: chars, World: world, Playerbots: bots}, nil
}

func (p *Pools) Close() {
	if p == nil {
		return
	}
	if p.Auth != nil {
		_ = p.Auth.Close()
	}
	if p.Characters != nil {
		_ = p.Characters.Close()
	}
	if p.World != nil {
		_ = p.World.Close()
	}
	if p.Playerbots != nil {
		_ = p.Playerbots.Close()
	}
}

func (p *Pools) Ping(ctx context.Context) error {
	if p == nil || p.Auth == nil || p.Characters == nil || p.World == nil {
		return fmt.Errorf("mysql pools not ready")
	}
	for _, db := range []*sql.DB{p.Auth, p.Characters, p.World} {
		if err := db.PingContext(ctx); err != nil {
			return err
		}
	}
	return nil
}
