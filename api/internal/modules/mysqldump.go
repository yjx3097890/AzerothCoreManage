package modules

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

// ResolveMysqldump finds mysqldump / mariadb-dump on PATH or common install locations.
func ResolveMysqldump(configured string) (string, error) {
	candidates := []string{}
	if configured != "" {
		candidates = append(candidates, configured)
	}
	candidates = append(candidates,
		"mysqldump",
		"mariadb-dump",
		"/opt/homebrew/opt/mysql-client/bin/mysqldump",
		"/opt/homebrew/opt/mysql/bin/mysqldump",
		"/opt/homebrew/opt/mariadb/bin/mariadb-dump",
		"/opt/homebrew/bin/mysqldump",
		"/usr/local/opt/mysql-client/bin/mysqldump",
		"/usr/local/bin/mysqldump",
	)
	seen := map[string]bool{}
	for _, c := range candidates {
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		if filepath.IsAbs(c) {
			if st, err := os.Stat(c); err == nil && !st.IsDir() {
				return c, nil
			}
			continue
		}
		if p, err := exec.LookPath(c); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("未找到 mysqldump：本地请 brew install mysql-client；Docker 部署请重建 API 镜像（已含 mariadb-client）。也可在 config 设置 backup.mysqldump_path")
}
