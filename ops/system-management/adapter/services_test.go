package main

import (
	"strings"
	"testing"
)

func TestProductionServiceReadiness(t *testing.T) {
	for _, tc := range []struct {
		name, kind, body, release string
		ready                     bool
	}{
		{"backend production identity", "backend", `{"status":"ok","ready":true,"release":{"id":"release-123","gitSha":"abc","runtimeMode":"primary"}}`, "release-123", true},
		{"backend not ready", "backend", `{"status":"ok","ready":false,"release":{"id":"release-123"}}`, "release-123", false},
		{"backend missing readiness", "backend", `{"status":"ok","release":{"id":"release-123"}}`, "release-123", false},
		{"backend missing identity", "backend", `{"status":"ok","ready":true,"release":{"gitSha":"abc"}}`, "", false},
		{"backend wrong identity type", "backend", `{"status":"ok","ready":true,"release":"release-123"}`, "", false},
		{"UI production identity", "ui", `{"status":"ok","service":"ui-server","release":"release-123"}`, "release-123", true},
		{"broker production identity", "broker", `{"ok":true,"release":"release-123"}`, "release-123", true},
		{"broker not ready", "broker", `{"ok":false,"release":"release-123"}`, "release-123", false},
		{"UI missing identity", "ui", `{"status":"ok"}`, "", false},
		{"malformed", "backend", `{"status":`, "", false},
		{"unsupported service", "postgresql", `{"status":"ok","release":"release-123"}`, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ready, release := decodeServiceReadiness(tc.kind, strings.NewReader(tc.body))
			if ready != tc.ready || release != tc.release {
				t.Fatalf("got (%v, %q), want (%v, %q)", ready, release, tc.ready, tc.release)
			}
		})
	}
}
