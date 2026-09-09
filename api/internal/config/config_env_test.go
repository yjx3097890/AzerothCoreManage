package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadExpandsEnv(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	cfgPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(envPath, []byte("PANEL_JWT_SECRET=s\nPANEL_ADMIN_USERNAME=a\nPANEL_ADMIN_PASSWORD=b\nTARGET_ID=t1\nTARGET_NAME=n1\nDOCKER_ENABLED=false\nAC_NETWORK=net\nSOAP_HOST=h\nSOAP_PORT=1\nSOAP_USERNAME=u\nSOAP_PASSWORD=p\nMYSQL_HOST=h\nMYSQL_PORT=2\nMYSQL_USER=u\nMYSQL_PASSWORD=p\nMYSQL_AUTH_DB=a\nMYSQL_CHARACTERS_DB=c\nMYSQL_WORLD_DB=w\nMYSQL_PLAYERBOTS_DB=pb\nAC_ROOT=/tmp/ac\nBOT_ACCOUNT_PREFIX=rndbot\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	yaml := `panel:
  listen: ":8080"
  jwt_secret: "${PANEL_JWT_SECRET}"
  admin_username: "${PANEL_ADMIN_USERNAME}"
  admin_password: "${PANEL_ADMIN_PASSWORD}"
targets:
  - id: "${TARGET_ID}"
    name: "${TARGET_NAME}"
    docker:
      enabled: ${DOCKER_ENABLED}
      host: "unix:///var/run/docker.sock"
      network: "${AC_NETWORK}"
      containers:
        worldserver: "ac-worldserver"
    soap:
      host: "${SOAP_HOST}"
      port: ${SOAP_PORT}
      username: "${SOAP_USERNAME}"
      password: "${SOAP_PASSWORD}"
    mysql:
      host: "${MYSQL_HOST}"
      port: ${MYSQL_PORT}
      user: "${MYSQL_USER}"
      password: "${MYSQL_PASSWORD}"
      auth_db: "${MYSQL_AUTH_DB}"
      characters_db: "${MYSQL_CHARACTERS_DB}"
      world_db: "${MYSQL_WORLD_DB}"
      playerbots_db: "${MYSQL_PLAYERBOTS_DB}"
    conf:
      etc_dir: "${AC_ROOT}/etc"
      playerbots_conf: "${AC_ROOT}/pb.conf"
      worldserver_conf: "${AC_ROOT}/ws.conf"
      authserver_conf: "${AC_ROOT}/as.conf"
    bots:
      account_prefix: "${BOT_ACCOUNT_PREFIX}"
soap:
  timeout_seconds: 1
  allow: ["server info"]
soap_deny: []
`
	if err := os.WriteFile(cfgPath, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.Unsetenv("AC_ROOT")
	cfg, err := Load(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Panel.Listen != ":8080" {
		t.Fatalf("listen=%q", cfg.Panel.Listen)
	}
	if cfg.Targets[0].Conf.EtcDir != "/tmp/ac/etc" {
		t.Fatalf("etc=%q", cfg.Targets[0].Conf.EtcDir)
	}
	if cfg.Targets[0].SOAP.Port != 1 {
		t.Fatalf("port=%d", cfg.Targets[0].SOAP.Port)
	}
}
