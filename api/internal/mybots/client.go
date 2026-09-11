package mybots

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client talks to mod-mybots JSON API on worldserver (Docker intranet).
type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

func New(host string, port int, token string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	host = strings.TrimSpace(host)
	if host == "" {
		host = "127.0.0.1"
	}
	return &Client{
		baseURL: fmt.Sprintf("http://%s:%d", host, port),
		token:   strings.TrimSpace(token),
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) BaseURL() string { return c.baseURL }

type Result struct {
	Status int
	Body   json.RawMessage
}

func (c *Client) Do(ctx context.Context, method, path string, body any) (*Result, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	} else if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch {
		reader = bytes.NewReader([]byte("{}"))
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("X-MyBots-Token", c.token)
	}
	if body != nil || method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		raw = []byte("null")
	}
	return &Result{Status: resp.StatusCode, Body: json.RawMessage(raw)}, nil
}

func (c *Client) DoRaw(ctx context.Context, method, path string, rawBody []byte) (*Result, error) {
	var reader io.Reader
	if rawBody != nil {
		reader = bytes.NewReader(rawBody)
	} else if method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch {
		reader = bytes.NewReader([]byte("{}"))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("X-MyBots-Token", c.token)
	}
	if rawBody != nil || method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		raw = []byte("null")
	}
	return &Result{Status: resp.StatusCode, Body: json.RawMessage(raw)}, nil
}

func EscapePath(seg string) string {
	return url.PathEscape(seg)
}
