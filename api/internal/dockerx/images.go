package dockerx

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

// ContainerImage returns the Image reference and ImageID for a whitelisted container.
func (c *Client) ContainerImage(ctx context.Context, nameOrRole string) (imageRef, imageID string, err error) {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return "", "", err
	}
	resp, err := c.do(ctx, http.MethodGet, "/containers/"+url.PathEscape(name)+"/json", nil)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("%s", truncate(string(b), 200))
	}
	var payload struct {
		Image   string `json:"Image"`
		ImageID string `json:"ImageID"`
	}
	if err := json.Unmarshal(b, &payload); err != nil {
		return "", "", err
	}
	return payload.Image, payload.ImageID, nil
}

// TagImage tags srcRef (name:tag or image id) as destRef (e.g. acmanage-ckpt-xxx:latest).
func (c *Client) TagImage(ctx context.Context, srcRef, destRef string) error {
	srcRef = strings.TrimSpace(srcRef)
	destRef = strings.TrimSpace(destRef)
	if srcRef == "" || destRef == "" {
		return fmt.Errorf("empty image ref")
	}
	repo, tag := splitImageRef(destRef)
	path := fmt.Sprintf("/images/%s/tag?repo=%s&tag=%s",
		escapeImagePath(srcRef), url.QueryEscape(repo), url.QueryEscape(tag))
	resp, err := c.do(ctx, http.MethodPost, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("tag: %s", truncate(string(b), 200))
	}
	return nil
}

// RemoveImage deletes an image by reference. Failures are returned to the caller.
func (c *Client) RemoveImage(ctx context.Context, ref string) error {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return fmt.Errorf("empty image ref")
	}
	path := "/images/" + escapeImagePath(ref) + "?force=0"
	resp, err := c.do(ctx, http.MethodDelete, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 404 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("rmi: %s", truncate(string(b), 200))
	}
	return nil
}

// ImageExists reports whether an image reference is known to the engine.
func (c *Client) ImageExists(ctx context.Context, ref string) bool {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return false
	}
	resp, err := c.do(ctx, http.MethodGet, "/images/"+escapeImagePath(ref)+"/json", nil)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode < 300
}

// RecreateFromImage stops a whitelisted container and recreates it with the same
// config/hostConfig/networks but Image set to imageRef, then starts it.
func (c *Client) RecreateFromImage(ctx context.Context, nameOrRole, imageRef string) error {
	_, name, err := c.resolve(nameOrRole)
	if err != nil {
		return err
	}
	imageRef = strings.TrimSpace(imageRef)
	if imageRef == "" {
		return fmt.Errorf("empty image ref")
	}

	resp, err := c.doLong(ctx, http.MethodGet, "/containers/"+url.PathEscape(name)+"/json", nil)
	if err != nil {
		return err
	}
	b, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("inspect: %s", truncate(string(b), 200))
	}

	var inspected map[string]any
	if err := json.Unmarshal(b, &inspected); err != nil {
		return err
	}
	cfg, _ := inspected["Config"].(map[string]any)
	hostCfg, _ := inspected["HostConfig"].(map[string]any)
	netSettings, _ := inspected["NetworkSettings"].(map[string]any)
	if cfg == nil {
		return fmt.Errorf("inspect missing Config")
	}
	cfg["Image"] = imageRef
	// Strip read-only / create-incompatible fields commonly present on inspect.
	delete(cfg, "Hostname")
	delete(cfg, "Domainname")

	// Engine API create expects Config fields at root plus HostConfig / NetworkingConfig.
	createBody := flattenCreateBody(cfg, hostCfg, netSettings)

	// Stop current container.
	if err := c.Stop(ctx, name); err != nil {
		return fmt.Errorf("stop: %w", err)
	}

	oldName := fmt.Sprintf("%s-acmanage-old-%d", name, time.Now().Unix())
	renamePath := fmt.Sprintf("/containers/%s/rename?name=%s", url.PathEscape(name), url.QueryEscape(oldName))
	rresp, err := c.doLong(ctx, http.MethodPost, renamePath, nil)
	if err != nil {
		return fmt.Errorf("rename: %w", err)
	}
	rb, _ := io.ReadAll(rresp.Body)
	_ = rresp.Body.Close()
	if rresp.StatusCode >= 300 {
		return fmt.Errorf("rename: %s", truncate(string(rb), 200))
	}

	payload, err := json.Marshal(createBody)
	if err != nil {
		return err
	}
	cresp, err := c.doLong(ctx, http.MethodPost, "/containers/create?name="+url.QueryEscape(name), bytes.NewReader(payload))
	if err != nil {
		// Best effort: rename old container back.
		_, _ = c.doLong(ctx, http.MethodPost, fmt.Sprintf("/containers/%s/rename?name=%s", url.PathEscape(oldName), url.QueryEscape(name)), nil)
		return fmt.Errorf("create: %w", err)
	}
	cb, _ := io.ReadAll(cresp.Body)
	_ = cresp.Body.Close()
	if cresp.StatusCode >= 300 {
		_, _ = c.doLong(ctx, http.MethodPost, fmt.Sprintf("/containers/%s/rename?name=%s", url.PathEscape(oldName), url.QueryEscape(name)), nil)
		return fmt.Errorf("create: %s", truncate(string(cb), 300))
	}

	if err := c.Start(ctx, name); err != nil {
		return fmt.Errorf("start: %w", err)
	}

	// Remove old container (best effort).
	dresp, err := c.doLong(ctx, http.MethodDelete, "/containers/"+url.PathEscape(oldName)+"?force=1", nil)
	if err == nil {
		_ = dresp.Body.Close()
	}
	return nil
}

func flattenCreateBody(cfg, hostCfg map[string]any, netSettings map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range cfg {
		out[k] = v
	}
	if hostCfg != nil {
		out["HostConfig"] = hostCfg
	}
	if netSettings != nil {
		if nets, ok := netSettings["Networks"].(map[string]any); ok && len(nets) > 0 {
			endpoints := map[string]any{}
			for name, raw := range nets {
				nm, _ := raw.(map[string]any)
				ep := map[string]any{}
				if nm != nil {
					for _, key := range []string{
						"IPAMConfig", "Links", "Aliases", "NetworkID",
						"EndpointID", "Gateway", "IPAddress", "IPPrefixLen",
						"IPv6Gateway", "GlobalIPv6Address", "GlobalIPv6PrefixLen",
						"MacAddress", "DriverOpts",
					} {
						if v, ok := nm[key]; ok && v != nil {
							ep[key] = v
						}
					}
				}
				endpoints[name] = ep
			}
			out["NetworkingConfig"] = map[string]any{"EndpointsConfig": endpoints}
		}
	}
	return out
}

func splitImageRef(ref string) (repo, tag string) {
	ref = strings.TrimPrefix(ref, "docker.io/")
	// digest
	if i := strings.Index(ref, "@"); i >= 0 {
		return ref[:i], ""
	}
	// last : after last /
	slash := strings.LastIndex(ref, "/")
	colon := strings.LastIndex(ref, ":")
	if colon > slash {
		return ref[:colon], ref[colon+1:]
	}
	return ref, "latest"
}

func escapeImagePath(ref string) string {
	// Engine API expects path-escaped image name; keep / and : by using PathEscape per segment carefully.
	// url.PathEscape encodes : which breaks some refs; use QueryEscape-style path for name.
	return strings.ReplaceAll(url.PathEscape(ref), "%2F", "/")
}
