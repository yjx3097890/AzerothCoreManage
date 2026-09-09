package dockerx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client talks to Docker Engine over the unix socket (or TCP host) without the heavy SDK.
type Client struct {
	http       *http.Client
	baseURL    string
	whitelist  map[string]string // role -> container name
	nameToRole map[string]string
}

func New(host string, containers map[string]string) (*Client, error) {
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	u, err := url.Parse(host)
	if err != nil {
		return nil, err
	}

	transport := &http.Transport{}
	base := "http://docker"
	switch u.Scheme {
	case "unix":
		sock := u.Path
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, "unix", sock)
		}
	case "tcp", "http":
		base = "http://" + u.Host
	case "https":
		base = "https://" + u.Host
	default:
		return nil, fmt.Errorf("unsupported docker host scheme %q", u.Scheme)
	}

	wl := map[string]string{}
	rev := map[string]string{}
	for role, name := range containers {
		if name == "" {
			continue
		}
		wl[role] = name
		rev[name] = role
	}

	return &Client{
		http: &http.Client{
			Transport: transport,
			Timeout:   60 * time.Second,
		},
		baseURL:    base,
		whitelist:  wl,
		nameToRole: rev,
	}, nil
}

func (c *Client) Close() error { return nil }

func (c *Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.http.Do(req)
}

func (c *Client) Ping(ctx context.Context) error {
	resp, err := c.do(ctx, http.MethodGet, "/_ping", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("docker ping: %s", truncate(string(b), 200))
	}
	return nil
}

type ContainerInfo struct {
	Role    string `json:"role"`
	Name    string `json:"name"`
	ID      string `json:"id"`
	Status  string `json:"status"`
	State   string `json:"state"`
	Running bool   `json:"running"`
	Found   bool   `json:"found"`
}

func (c *Client) resolve(nameOrRole string) (role, name string, err error) {
	if n, ok := c.whitelist[nameOrRole]; ok {
		return nameOrRole, n, nil
	}
	if role, ok := c.nameToRole[nameOrRole]; ok {
		return role, nameOrRole, nil
	}
	return "", "", fmt.Errorf("container %q not in whitelist", nameOrRole)
}

func (c *Client) List(ctx context.Context) ([]ContainerInfo, error) {
	out := make([]ContainerInfo, 0, len(c.whitelist))
	for role, name := range c.whitelist {
		info, err := c.inspect(ctx, role, name)
		if err != nil {
			out = append(out, ContainerInfo{Role: role, Name: name, Found: false, Status: err.Error()})
			continue
		}
		out = append(out, info)
	}
	return out, nil
}

func (c *Client) inspect(ctx context.Context, role, name string) (ContainerInfo, error) {
	resp, err := c.do(ctx, http.MethodGet, "/containers/"+url.PathEscape(name)+"/json", nil)
	if err != nil {
		return ContainerInfo{}, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return ContainerInfo{}, fmt.Errorf("%s", truncate(string(b), 200))
	}
	var payload struct {
		ID    string `json:"Id"`
		State struct {
			Status  string `json:"Status"`
			Running bool   `json:"Running"`
		} `json:"State"`
		Name string `json:"Name"`
	}
	if err := json.Unmarshal(b, &payload); err != nil {
		return ContainerInfo{}, err
	}
	return ContainerInfo{
		Role:    role,
		Name:    strings.TrimPrefix(payload.Name, "/"),
		ID:      payload.ID,
		Status:  payload.State.Status,
		State:   payload.State.Status,
		Running: payload.State.Running,
		Found:   true,
	}, nil
}

func (c *Client) Start(ctx context.Context, nameOrRole string) error {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return err
	}
	resp, err := c.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(name)+"/start", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 304 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("start: %s", truncate(string(b), 200))
	}
	return nil
}

func (c *Client) Stop(ctx context.Context, nameOrRole string) error {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return err
	}
	resp, err := c.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(name)+"/stop?t=20", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 304 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("stop: %s", truncate(string(b), 200))
	}
	return nil
}

func (c *Client) Restart(ctx context.Context, nameOrRole string) error {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return err
	}
	resp, err := c.do(ctx, http.MethodPost, "/containers/"+url.PathEscape(name)+"/restart?t=20", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("restart: %s", truncate(string(b), 200))
	}
	return nil
}

func (c *Client) Stats(ctx context.Context, nameOrRole string) (map[string]any, error) {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return nil, err
	}
	path := "/containers/" + url.PathEscape(name) + "/stats?stream=0"
	resp, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("stats: %s", truncate(string(b), 200))
	}
	var raw map[string]any
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	out := map[string]any{"name": name, "raw_ok": true}

	// CPU %
	cpuStats, _ := raw["cpu_stats"].(map[string]any)
	preCPU, _ := raw["precpu_stats"].(map[string]any)
	if cpuStats != nil && preCPU != nil {
		cpuDelta := num(cpuStats["cpu_usage"], "total_usage") - num(preCPU["cpu_usage"], "total_usage")
		sysDelta := toF(cpuStats["system_cpu_usage"]) - toF(preCPU["system_cpu_usage"])
		online := toF(cpuStats["online_cpus"])
		if online <= 0 {
			online = float64(len(sliceAny(cpuStats["cpu_usage"], "percpu_usage")))
		}
		if sysDelta > 0 && cpuDelta > 0 && online > 0 {
			out["cpu_percent"] = (cpuDelta / sysDelta) * online * 100
		}
	}

	mem, _ := raw["memory_stats"].(map[string]any)
	if mem != nil {
		usage := toF(mem["usage"])
		limit := toF(mem["limit"])
		out["mem_usage"] = usage
		out["mem_limit"] = limit
		if limit > 0 {
			out["mem_percent"] = usage / limit * 100
		}
	}
	return out, nil
}

func toF(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	case int:
		return float64(t)
	case int64:
		return float64(t)
	default:
		return 0
	}
}

func num(m any, key string) float64 {
	mm, _ := m.(map[string]any)
	if mm == nil {
		return 0
	}
	return toF(mm[key])
}

func sliceAny(m any, key string) []any {
	mm, _ := m.(map[string]any)
	if mm == nil {
		return nil
	}
	s, _ := mm[key].([]any)
	return s
}

func (c *Client) Logs(ctx context.Context, nameOrRole string, tail string) (string, error) {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return "", err
	}
	if tail == "" {
		tail = "200"
	}
	path := fmt.Sprintf("/containers/%s/logs?stdout=1&stderr=1&timestamps=1&tail=%s", url.PathEscape(name), url.QueryEscape(tail))
	resp, err := c.do(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("logs: %s", truncate(string(b), 200))
	}
	return decodeDockerLogs(b), nil
}

// LogsFollow streams demultiplexed docker logs until ctx is cancelled.
func (c *Client) LogsFollow(ctx context.Context, nameOrRole string, tail string, write func(line string) error) error {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return err
	}
	if tail == "" {
		tail = "100"
	}
	path := fmt.Sprintf("/containers/%s/logs?stdout=1&stderr=1&timestamps=1&follow=1&tail=%s",
		url.PathEscape(name), url.QueryEscape(tail))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	// follow streams need no client timeout
	client := &http.Client{Transport: c.http.Transport}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("logs: %s", truncate(string(b), 200))
	}
	return streamDockerLogs(resp.Body, write)
}

func decodeDockerLogs(b []byte) string {
	var out strings.Builder
	_ = streamDockerLogs(bytes.NewReader(b), func(line string) error {
		out.WriteString(line)
		out.WriteByte('\n')
		return nil
	})
	return strings.TrimRight(out.String(), "\n")
}

func streamDockerLogs(r io.Reader, write func(line string) error) error {
	hdr := make([]byte, 8)
	buf := make([]byte, 0, 4096)
	for {
		_, err := io.ReadFull(r, hdr)
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			if len(buf) > 0 {
				if werr := write(string(buf)); werr != nil {
					return werr
				}
			}
			return nil
		}
		if err != nil {
			return err
		}
		size := int(hdr[4])<<24 | int(hdr[5])<<16 | int(hdr[6])<<8 | int(hdr[7])
		if size <= 0 || size > 1<<20 {
			// not multiplexed; treat remainder as text
			rest, _ := io.ReadAll(r)
			all := append(append([]byte{}, hdr...), rest...)
			for _, line := range strings.Split(string(bytes.ReplaceAll(all, []byte{0}, nil)), "\n") {
				if line == "" {
					continue
				}
				if err := write(line); err != nil {
					return err
				}
			}
			return nil
		}
		chunk := make([]byte, size)
		if _, err := io.ReadFull(r, chunk); err != nil {
			return err
		}
		buf = append(buf, chunk...)
		for {
			i := bytes.IndexByte(buf, '\n')
			if i < 0 {
				break
			}
			line := string(buf[:i])
			buf = buf[i+1:]
			if err := write(line); err != nil {
				return err
			}
		}
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
