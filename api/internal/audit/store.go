package audit

import (
	"context"
	"database/sql"
	"time"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type Entry struct {
	ID        int64     `json:"id"`
	At        time.Time `json:"at"`
	Username  string    `json:"username"`
	Role      string    `json:"role"`
	TargetID  string    `json:"target_id"`
	Action    string    `json:"action"`
	Detail    string    `json:"detail"`
	OK        bool      `json:"ok"`
	Error     string    `json:"error,omitempty"`
}

func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db}
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT NOT NULL DEFAULT ''
)`)
	if err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) Write(ctx context.Context, e Entry) error {
	if s == nil {
		return nil
	}
	if e.At.IsZero() {
		e.At = time.Now().UTC()
	}
	ok := 0
	if e.OK {
		ok = 1
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO audit_log(at,username,role,target_id,action,detail,ok,error) VALUES(?,?,?,?,?,?,?,?)`,
		e.At.Format(time.RFC3339), e.Username, e.Role, e.TargetID, e.Action, e.Detail, ok, e.Error,
	)
	return err
}

func (s *Store) List(ctx context.Context, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id,at,username,role,target_id,action,detail,ok,error FROM audit_log ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Entry
	for rows.Next() {
		var e Entry
		var at string
		var okInt int
		if err := rows.Scan(&e.ID, &at, &e.Username, &e.Role, &e.TargetID, &e.Action, &e.Detail, &okInt, &e.Error); err != nil {
			return nil, err
		}
		e.At, _ = time.Parse(time.RFC3339, at)
		e.OK = okInt == 1
		out = append(out, e)
	}
	return out, rows.Err()
}
