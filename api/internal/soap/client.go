package soap

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope
  xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:ns1="urn:AC">
  <SOAP-ENV:Body>
    <ns1:executeCommand>
      <command>%s</command>
    </ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`

type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client
}

func New(host string, port int, username, password string, timeout time.Duration) *Client {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &Client{
		baseURL:  fmt.Sprintf("http://%s:%d/", host, port),
		username: username,
		password: password,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

type soapEnvelope struct {
	XMLName xml.Name `xml:"Envelope"`
	Body    soapBody `xml:"Body"`
}

type soapBody struct {
	Fault    *soapFault `xml:"Fault"`
	Response *struct {
		Result string `xml:"result"`
	} `xml:"executeCommandResponse"`
}

type soapFault struct {
	FaultCode   string `xml:"faultcode"`
	FaultString string `xml:"faultstring"`
}

func (c *Client) Execute(ctx context.Context, command string) (string, error) {
	body := fmt.Sprintf(envelope, xmlEscape(command))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL, bytes.NewBufferString(body))
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/xml")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var env soapEnvelope
	if err := xml.Unmarshal(raw, &env); err != nil {
		return "", fmt.Errorf("parse soap: %w: %s", err, truncate(string(raw), 300))
	}
	if env.Body.Fault != nil {
		return "", fmt.Errorf("soap fault: %s", env.Body.Fault.FaultString)
	}
	if env.Body.Response == nil {
		return "", fmt.Errorf("empty soap response: %s", truncate(string(raw), 300))
	}
	return strings.TrimSpace(env.Body.Response.Result), nil
}

func xmlEscape(s string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	)
	return replacer.Replace(s)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
