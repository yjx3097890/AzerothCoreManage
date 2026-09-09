package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

type Config struct {
	Panel    Panel      `mapstructure:"panel"`
	Targets  []Target   `mapstructure:"targets"`
	SOAP     SOAPPolicy `mapstructure:"soap"`
	SOAPDeny []string   `mapstructure:"soap_deny"`
}

type Panel struct {
	Listen        string `mapstructure:"listen"`
	JWTSecret     string `mapstructure:"jwt_secret"`
	AdminUsername string `mapstructure:"admin_username"`
	AdminPassword string `mapstructure:"admin_password"`
}

type Target struct {
	ID     string       `mapstructure:"id"`
	Name   string       `mapstructure:"name"`
	Docker Docker       `mapstructure:"docker"`
	SOAP   SOAPEndpoint `mapstructure:"soap"`
	MySQL  MySQL        `mapstructure:"mysql"`
	Conf   ConfPaths    `mapstructure:"conf"`
	Bots   Bots         `mapstructure:"bots"`
	Backup Backup       `mapstructure:"backup"`
}

type Docker struct {
	Enabled    bool              `mapstructure:"enabled"`
	Host       string            `mapstructure:"host"`
	Network    string            `mapstructure:"network"`
	Containers map[string]string `mapstructure:"containers"`
}

type SOAPEndpoint struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Username string `mapstructure:"username"`
	Password string `mapstructure:"password"`
}

type MySQL struct {
	Host         string `mapstructure:"host"`
	Port         int    `mapstructure:"port"`
	User         string `mapstructure:"user"`
	Password     string `mapstructure:"password"`
	AuthDB       string `mapstructure:"auth_db"`
	CharactersDB string `mapstructure:"characters_db"`
	WorldDB      string `mapstructure:"world_db"`
	PlayerbotsDB string `mapstructure:"playerbots_db"`
}

type ConfPaths struct {
	EtcDir          string `mapstructure:"etc_dir"`
	PlayerbotsConf  string `mapstructure:"playerbots_conf"`
	WorldserverConf string `mapstructure:"worldserver_conf"`
	AuthserverConf  string `mapstructure:"authserver_conf"`
}

type Backup struct {
	Dir           string `mapstructure:"dir"`
	MysqldumpPath string `mapstructure:"mysqldump_path"`
}

type Bots struct {
	AccountPrefix string `mapstructure:"account_prefix"`
}

type SOAPPolicy struct {
	TimeoutSeconds int      `mapstructure:"timeout_seconds"`
	Allow          []string `mapstructure:"allow"`
}

func Load(path string) (*Config, error) {
	loadDotEnvFiles(path)

	v := viper.New()
	v.SetConfigType("yaml")

	if path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}
		expanded := os.ExpandEnv(string(raw))
		if err := v.ReadConfig(strings.NewReader(expanded)); err != nil {
			return nil, fmt.Errorf("parse config: %w", err)
		}
	} else {
		v.SetConfigName("config")
		v.AddConfigPath(".")
		v.AddConfigPath("..")
		v.AddConfigPath("/etc/acmanage")
		if err := v.ReadInConfig(); err != nil {
			return nil, fmt.Errorf("read config: %w", err)
		}
		// Re-read with env expansion when path was discovered by viper.
		if cfgFile := v.ConfigFileUsed(); cfgFile != "" {
			raw, err := os.ReadFile(cfgFile)
			if err != nil {
				return nil, fmt.Errorf("read config: %w", err)
			}
			v = viper.New()
			v.SetConfigType("yaml")
			if err := v.ReadConfig(strings.NewReader(os.ExpandEnv(string(raw)))); err != nil {
				return nil, fmt.Errorf("parse config: %w", err)
			}
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}
	if cfg.Panel.Listen == "" {
		cfg.Panel.Listen = ":8080"
	}
	if len(cfg.Targets) == 0 {
		return nil, fmt.Errorf("config.targets is empty")
	}
	return &cfg, nil
}

func (c *Config) Target(id string) (*Target, error) {
	if id == "" {
		return &c.Targets[0], nil
	}
	for i := range c.Targets {
		if c.Targets[i].ID == id {
			return &c.Targets[i], nil
		}
	}
	return nil, fmt.Errorf("unknown target %q", id)
}

// loadDotEnvFiles loads KEY=VALUE from nearby .env files into the process env
// (does not override already-set variables). Docker Compose also reads .env
// for its own ${} substitution; this makes `make api` behave the same.
func loadDotEnvFiles(configPath string) {
	candidates := []string{".env", "../.env"}
	if configPath != "" {
		dir := filepath.Dir(configPath)
		candidates = append([]string{
			filepath.Join(dir, ".env"),
			filepath.Join(dir, "..", ".env"),
		}, candidates...)
	}
	seen := map[string]bool{}
	for _, p := range candidates {
		abs, err := filepath.Abs(p)
		if err != nil || seen[abs] {
			continue
		}
		seen[abs] = true
		_ = loadDotEnvFile(abs)
	}
}

func loadDotEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 {
			if (val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'') {
				val = val[1 : len(val)-1]
			}
		}
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, val)
	}
	return sc.Err()
}
