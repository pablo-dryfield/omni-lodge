package main

import (
	"encoding/json"
	"slices"
	"testing"
)

func TestCopyWorkerHostTemporaryPathsRequireRootCapability(t *testing.T) {
	for _, test := range []struct {
		name       string
		root       RootPolicy
		capability bool
		privateTmp string
	}{
		{"ordinary workspace", RootPolicy{Path: "/srv/work"}, false, "yes"},
		{"ordinary workspace cannot request root", RootPolicy{Path: "/srv/work"}, true, "yes"},
		{"root without signed capability", RootPolicy{Path: "/", Privileged: true}, false, "yes"},
		{"approved root filesystem", RootPolicy{Path: "/", Privileged: true}, true, "no"},
	} {
		t.Run(test.name, func(t *testing.T) {
			capability, _ := json.Marshal(test.capability)
			e := Envelope{ActorID: 1, Params: map[string]json.RawMessage{"rootId": json.RawMessage(`"server"`), "privilegedRoot": capability}}
			p := Policy{Actors: map[string]Actor{"1": {Roots: map[string]RootPolicy{"server": test.root}}}}
			args := copyWorkerArguments(e, p, "test-operation")
			if !slices.Contains(args, "--property=PrivateTmp="+test.privateTmp) {
				t.Fatalf("wrong temporary namespace: %v", args)
			}
		})
	}
}
