package config

import (
	"fmt"

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
	v := viper.New()
	v.SetConfigType("yaml")

	if path != "" {
		v.SetConfigFile(path)
	} else {
		v.SetConfigName("config")
		v.AddConfigPath(".")
		v.AddConfigPath("..")
		v.AddConfigPath("/etc/acmanage")
	}

	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
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
