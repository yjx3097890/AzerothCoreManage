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
	DeepSeek DeepSeek   `mapstructure:"deepseek"`
	GitHub   GitHub     `mapstructure:"github"`
	Modules  ModulesGlobal `mapstructure:"modules_global"`
}

type Panel struct {
	Listen        string `mapstructure:"listen"`
	JWTSecret     string `mapstructure:"jwt_secret"`
	AdminUsername string `mapstructure:"admin_username"`
	AdminPassword string `mapstructure:"admin_password"`
}

type Target struct {
	ID      string       `mapstructure:"id"`
	Name    string       `mapstructure:"name"`
	Docker  Docker       `mapstructure:"docker"`
	SOAP    SOAPEndpoint `mapstructure:"soap"`
	MySQL   MySQL        `mapstructure:"mysql"`
	Conf    ConfPaths    `mapstructure:"conf"`
	Bots    Bots         `mapstructure:"bots"`
	Backup  Backup       `mapstructure:"backup"`
	Modules Modules      `mapstructure:"modules"`
}

type DeepSeek struct {
	APIKey  string `mapstructure:"api_key"`
	BaseURL string `mapstructure:"base_url"`
	Model   string `mapstructure:"model"`
}

type GitHub struct {
	Token string `mapstructure:"token"`
}

// ModulesGlobal holds panel-side paths shared across targets (registry, caches).
type ModulesGlobal struct {
	RegistryPath  string `mapstructure:"registry_path"`
	CacheDir      string `mapstructure:"cache_dir"`
	CuratedPath   string `mapstructure:"curated_path"`
}

type Modules struct {
	Enabled             bool     `mapstructure:"enabled"`
	Deploy              string   `mapstructure:"deploy"` // docker | source
	ModulesDir          string   `mapstructure:"modules_dir"`
	ModulesList         string   `mapstructure:"modules_list"`
	EtcModulesDir       string   `mapstructure:"etc_modules_dir"`
	ComposeDir          string   `mapstructure:"compose_dir"`
	WorldService        string   `mapstructure:"world_service"`
	// CoreVersion / CoreRevision: last-resort when SOAP server info and AC_ROOT git are unavailable.
	CoreVersion         string   `mapstructure:"core_version"`
	CoreRevision        string   `mapstructure:"core_revision"`
	AllowOwners         []string `mapstructure:"allow_owners"`
	AllowedHosts        []string `mapstructure:"allowed_hosts"`
	CheckpointKeep      int      `mapstructure:"checkpoint_keep"`
	BuildTimeoutMinutes int      `mapstructure:"build_timeout_minutes"`
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
	applyModulesDefaults(&cfg)
	return &cfg, nil
}

func applyModulesDefaults(cfg *Config) {
	if cfg.DeepSeek.BaseURL == "" || cfg.DeepSeek.BaseURL == "${DEEPSEEK_BASE_URL}" {
		if v := strings.TrimSpace(os.Getenv("DEEPSEEK_BASE_URL")); v != "" {
			cfg.DeepSeek.BaseURL = v
		} else {
			cfg.DeepSeek.BaseURL = "https://api.deepseek.com"
		}
	}
	if cfg.DeepSeek.Model == "" || cfg.DeepSeek.Model == "${DEEPSEEK_MODEL}" {
		cfg.DeepSeek.Model = "deepseek-v4-flash"
	}
	if cfg.DeepSeek.APIKey == "" {
		cfg.DeepSeek.APIKey = os.Getenv("DEEPSEEK_API_KEY")
	}
	if cfg.GitHub.Token == "" {
		cfg.GitHub.Token = os.Getenv("GITHUB_TOKEN")
	}
	if cfg.Modules.RegistryPath == "" {
		cfg.Modules.RegistryPath = "../data/module-registry.json"
	}
	if cfg.Modules.CacheDir == "" {
		cfg.Modules.CacheDir = "../data/module-cache"
	}
	if cfg.Modules.CuratedPath == "" {
		cfg.Modules.CuratedPath = "data/modules/curated.json"
	}
	for i := range cfg.Targets {
		m := &cfg.Targets[i].Modules
		if m.Deploy == "" {
			m.Deploy = "docker"
		}
		if m.WorldService == "" {
			m.WorldService = "ac-worldserver"
		}
		if len(m.AllowOwners) == 0 {
			m.AllowOwners = []string{"azerothcore"}
		}
		if len(m.AllowedHosts) == 0 {
			m.AllowedHosts = []string{"github.com"}
		}
		if m.CheckpointKeep <= 0 {
			m.CheckpointKeep = 5
		}
		if m.BuildTimeoutMinutes <= 0 {
			m.BuildTimeoutMinutes = 45
		}
		// Default Enabled=true when modules_dir is configured or AC_ROOT is set.
		if !m.Enabled && (m.ModulesDir != "" || os.Getenv("AC_ROOT") != "") {
			m.Enabled = true
		}
		if m.ModulesDir == "" {
			if root := os.Getenv("AC_ROOT"); root != "" {
				m.ModulesDir = filepath.Join(root, "modules")
			}
		}
		if m.ModulesList == "" {
			if root := os.Getenv("AC_ROOT"); root != "" {
				m.ModulesList = filepath.Join(root, "conf", "modules.list")
			}
		}
		if m.EtcModulesDir == "" {
			if cfg.Targets[i].Conf.EtcDir != "" {
				m.EtcModulesDir = filepath.Join(cfg.Targets[i].Conf.EtcDir, "modules")
			}
		}
		if m.ComposeDir == "" {
			if root := os.Getenv("AC_ROOT"); root != "" {
				m.ComposeDir = root
			}
		}
	}
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
