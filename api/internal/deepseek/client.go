package deepseek

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	APIKey  string
	BaseURL string
	Model   string
	HTTP    *http.Client
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string         `json:"model"`
	Messages       []Message      `json:"messages"`
	Temperature    float64        `json:"temperature"`
	MaxTokens      int            `json:"max_tokens"`
	ResponseFormat map[string]any `json:"response_format"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func New(apiKey, baseURL, model string) *Client {
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	if model == "" || model == "${DEEPSEEK_MODEL}" {
		model = "deepseek-v4-flash"
	}
	return &Client{
		APIKey:  apiKey,
		BaseURL: strings.TrimRight(baseURL, "/"),
		Model:   model,
		HTTP:    &http.Client{Timeout: 90 * time.Second},
	}
}

func (c *Client) Configured() bool {
	return c != nil && strings.TrimSpace(c.APIKey) != ""
}

func (c *Client) ChatJSON(ctx context.Context, system, user string) (json.RawMessage, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("deepseek_unconfigured")
	}
	// Prefer configured model; empty / unexpanded env falls back here.
	model := strings.TrimSpace(c.Model)
	if model == "" || model == "${DEEPSEEK_MODEL}" {
		model = "deepseek-v4-flash"
	}
	try := func(withThinking bool) (json.RawMessage, error) {
		body := map[string]any{
			"model": model,
			"messages": []Message{
				{Role: "system", Content: system},
				{Role: "user", Content: user},
			},
			"temperature":     0.2,
			"max_tokens":      4096,
			"response_format": map[string]any{"type": "json_object"},
		}
		if withThinking {
			body["thinking"] = map[string]any{"type": "disabled"}
		}
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/chat/completions", bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		resp, err := c.HTTP.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		respBody, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
		if err != nil {
			return nil, err
		}
		if resp.StatusCode >= 300 {
			return nil, fmt.Errorf("deepseek http %d: %s", resp.StatusCode, truncate(string(respBody), 300))
		}
		var parsed struct {
			Choices []struct {
				Message struct {
					Content          string `json:"content"`
					ReasoningContent string `json:"reasoning_content"`
				} `json:"message"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(respBody, &parsed); err != nil {
			return nil, err
		}
		if parsed.Error != nil {
			return nil, fmt.Errorf("deepseek: %s", parsed.Error.Message)
		}
		if len(parsed.Choices) == 0 {
			return nil, fmt.Errorf("deepseek empty choices")
		}
		content := strings.TrimSpace(parsed.Choices[0].Message.Content)
		if content == "" {
			// Some reasoner responses put JSON only after thinking; try extract.
			content = extractJSONObject(parsed.Choices[0].Message.ReasoningContent)
		}
		if content == "" {
			return nil, fmt.Errorf("deepseek empty content")
		}
		if !json.Valid([]byte(content)) {
			if extracted := extractJSONObject(content); extracted != "" && json.Valid([]byte(extracted)) {
				content = extracted
			} else {
				return nil, fmt.Errorf("deepseek non-json content")
			}
		}
		return json.RawMessage(content), nil
	}
	out, err := try(true)
	if err != nil && strings.Contains(err.Error(), "thinking") {
		return try(false)
	}
	return out, err
}

func extractJSONObject(s string) string {
	s = strings.TrimSpace(s)
	i := strings.Index(s, "{")
	j := strings.LastIndex(s, "}")
	if i >= 0 && j > i {
		return s[i : j+1]
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
