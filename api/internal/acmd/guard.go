package acmd

import (
	"fmt"
	"strings"
)

type Guard struct {
	allow []string
	deny  []string
}

func New(allow, deny []string) *Guard {
	return &Guard{allow: allow, deny: deny}
}

func (g *Guard) Check(command string) error {
	cmd := strings.TrimSpace(strings.TrimLeft(command, "./"))
	if cmd == "" {
		return fmt.Errorf("empty command")
	}
	lower := strings.ToLower(cmd)
	for _, d := range g.deny {
		if matchPrefix(lower, d) {
			return fmt.Errorf("command denied: %s", d)
		}
	}
	if len(g.allow) == 0 {
		return fmt.Errorf("command allow-list is empty")
	}
	for _, a := range g.allow {
		if matchPrefix(lower, a) {
			return nil
		}
	}
	return fmt.Errorf("command not allowed: %s", firstToken(cmd))
}

func matchPrefix(command, pattern string) bool {
	p := strings.ToLower(strings.TrimSpace(strings.TrimLeft(pattern, "./")))
	if p == "" {
		return false
	}
	return command == p || strings.HasPrefix(command, p+" ")
}

func firstToken(command string) string {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return command
	}
	if len(fields) == 1 {
		return fields[0]
	}
	return fields[0] + " " + fields[1]
}
