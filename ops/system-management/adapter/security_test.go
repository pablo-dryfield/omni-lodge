package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAuthorizationBinding(t *testing.T) {
	public, private, _ := ed25519.GenerateKey(rand.Reader)
	p := Policy{HostID: "production", PublicKey: base64.StdEncoding.EncodeToString(public), Actors: map[string]Actor{"1": {Username: "operator"}}}
	now := time.Now()
	e := Envelope{Version: 1, ActorID: 1, HostID: "production", Nonce: "12345678-1234-1234-1234-123456789abc", Expires: now.Add(20 * time.Second).UnixMilli()}
	ticket := func(v Envelope) string {
		payload, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(payload) + "." + base64.RawURLEncoding.EncodeToString(ed25519.Sign(private, payload))
	}
	if _, err := verify(ticket(e), p, now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Envelope){func(v *Envelope) { v.HostID = "other" }, func(v *Envelope) { v.ActorID = 2 }, func(v *Envelope) { v.Expires = now.Add(-time.Second).UnixMilli() }, func(v *Envelope) { v.Expires = now.Add(time.Minute).UnixMilli() }, func(v *Envelope) { v.Nonce = "../../escape" }} {
		copy := e
		change(&copy)
		if _, err := verify(ticket(copy), p, now); err == nil {
			t.Fatal("invalid binding accepted")
		}
	}
	signed := ticket(e)
	if _, err := verify(signed[:len(signed)-4]+"AAAA", p, now); err == nil {
		t.Fatal("tampered signature accepted")
	}
}
func TestRelativePaths(t *testing.T) {
	for _, value := range []string{"../outside", "a/../../b", "/etc/passwd", "a\\b", "a\x00b", ".omnilodge-private/file"} {
		if _, err := safePath(value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
	for _, value := range []string{"reports/file.txt", "hello world.txt", "folder/ąę.txt", "."} {
		if _, err := safePath(value); err != nil {
			t.Fatal(err)
		}
	}
}
func TestRootCannotEscape(t *testing.T) {
	dir := t.TempDir()
	outside := t.TempDir()
	_ = os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600)
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if _, err = root.Open("../secret"); err == nil {
		t.Fatal("root traversal allowed")
	}
	if err = os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Skip("symlink creation unavailable on this OS")
	}
	if err = noLinks(root, "link/secret", false); err == nil {
		t.Fatal("symlink traversal allowed")
	}
	if _, err = root.Open("link/secret"); err == nil {
		t.Fatal("root followed escaping symlink")
	}
}
