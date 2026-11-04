package main

import (
	"encoding/json"
	"testing"
)

func TestRootDeploymentPathsStayReadOnly(t *testing.T) {
	root := RootPolicy{Path: "/", Privileged: true}
	for _, name := range []string{".", "opt", "opt/omnilodge/releases/a", "usr/local/libexec/omnilodge/system-adapter", "var/lib/omnilodge/deploy/state"} {
		if rootMutationPath(root, name) == nil {
			t.Fatalf("protected mutation accepted: %s", name)
		}
	}
	for _, name := range []string{"etc/example.conf", "var/log/test.log", "tmp/example", "srv/backups/example"} {
		if err := rootMutationPath(root, name); err != nil {
			t.Fatal(err)
		}
	}
	if rootMutationPath(RootPolicy{Path: "/elsewhere", Privileged: true}, "file") == nil {
		t.Fatal("invalid root policy accepted")
	}
}
func TestRootCapabilityMustBeSignedForTheCurrentProfile(t *testing.T) {
	actor := Actor{Roots: map[string]RootPolicy{"server": {Path: "/", Privileged: true}}}
	e := Envelope{Params: map[string]json.RawMessage{"rootId": json.RawMessage(`"server"`), "privilegedRoot": json.RawMessage(`false`)}}
	if rootCapability(e, actor) == nil {
		t.Fatal("ordinary profile inherited retained root policy")
	}
	e.Params["privilegedRoot"] = json.RawMessage(`true`)
	if err := rootCapability(e, actor); err != nil {
		t.Fatal(err)
	}
}
