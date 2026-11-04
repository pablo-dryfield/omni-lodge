package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type CopyLease struct {
	PolicyHash   string `json:"policyHash"`
	LeaseSeconds int    `json:"leaseSeconds"`
	ID           string `json:"id"`
	ActorID      int    `json:"actorId"`
	State        string `json:"state"`
	Until        int64  `json:"until"`
	Deadline     int64  `json:"deadline"`
}

func copyLeasePath(id string) string { return filepath.Join(statePath, "leases", id+".json") }
func readCopyLease(id string) (CopyLease, error) {
	var result CopyLease
	if !uuid.MatchString(id) {
		return result, errors.New("invalid copy identity")
	}
	data, err := os.ReadFile(copyLeasePath(id))
	if err == nil {
		err = json.Unmarshal(data, &result)
	}
	return result, err
}
func queueCopy(e Envelope, p Policy) (map[string]any, error) {
	id := str(e.Params, "operationId")
	if !uuid.MatchString(id) {
		return nil, errors.New("invalid copy operation identity")
	}
	admission, err := namedLock("copy-admission")
	if err != nil {
		return nil, err
	}
	defer admission.Close()
	guard, err := namedLock(id)
	if err != nil {
		return nil, err
	}
	defer guard.Close()
	encoded, _ := json.Marshal(e.Params)
	digest := sha256.Sum256(append([]byte(e.Action+":"), encoded...))
	hash := hex.EncodeToString(digest[:])
	if old, err := loadRecord(id); err == nil {
		if old.ActorID != e.ActorID || old.Action != e.Action || old.PayloadHash != hash || old.Fence != integer(e.Params, "fence") {
			return nil, errors.New("copy operation identity mismatch")
		}
		if old.State == "completed" {
			return old.Result, nil
		}
		return map[string]any{"queued": true, "operationId": id, "state": old.State}, nil
	}
	if err = os.MkdirAll(filepath.Join(statePath, "leases"), 0700); err != nil {
		return nil, err
	}
	entries, err := boundedEntries(filepath.Join(statePath, "leases"))
	if err != nil {
		return nil, err
	}
	total, owned := 0, 0
	for _, entry := range entries {
		lease, err := readCopyLease(strings.TrimSuffix(entry.Name(), ".json"))
		if err == nil && lease.State == "running" && lease.Until > time.Now().UnixMilli() {
			total++
			if lease.ActorID == e.ActorID {
				owned++
			}
		}
	}
	if total >= 2 || owned >= 1 {
		return nil, errors.New("managed copy concurrency reached")
	}
	record := Record{ID: id, ActorID: e.ActorID, Action: e.Action, PayloadHash: hash, Fence: integer(e.Params, "fence"), State: "queued", Envelope: &e, ExpiresAt: int64(integer(e.Params, "metadataExpiresAt"))}
	if err = createRecord(record); err != nil {
		return nil, err
	}
	lease := CopyLease{ID: id, ActorID: e.ActorID, State: "running", Until: time.Now().Add(time.Duration(p.LeaseSeconds) * time.Second).UnixMilli(), Deadline: min(p.RuntimeExpires, time.Now().Add(20*time.Minute).UnixMilli()), PolicyHash: e.PolicyHash, LeaseSeconds: p.LeaseSeconds}
	if err = atomicJSON(copyLeasePath(id), lease); err != nil {
		return nil, err
	}
	_, err = boundedCommand("/usr/bin/systemd-run", copyWorkerArguments(e, p, id)...)
	if err != nil {
		return nil, err
	}
	return map[string]any{"queued": true, "operationId": id, "state": "queued"}, nil
}
func copyWorkerArguments(e Envelope, p Policy, id string) []string {
	privateTmp := "yes"
	actor := p.Actors[strconv.Itoa(e.ActorID)]
	root := actor.Roots[str(e.Params, "rootId")]
	// A root filesystem operation must see the same host /tmp and /var/tmp
	// that were reviewed over SFTP. Ordinary workspaces retain private temp.
	if root.Privileged && root.Path == "/" && boolean(e.Params, "privilegedRoot") {
		privateTmp = "no"
	}
	return []string{"--quiet", "--no-block", "--collect", "--unit=omnilodge-copy-" + id, "--property=Type=exec", "--property=RuntimeMaxSec=1200s", "--property=MemoryMax=134217728", "--property=CPUQuota=25%", "--property=TasksMax=32", "--property=Slice=omnilodge-console.slice", "--property=NoNewPrivileges=yes", "--property=PrivateTmp=" + privateTmp, "--", "/usr/local/libexec/omnilodge/system-adapter", "copy-operation", id}
}
func completeCopy(id string, p Policy) error {
	record, err := loadRecord(id)
	if err != nil {
		return err
	}
	if record.State != "queued" || record.Envelope == nil || record.Envelope.ActorID != record.ActorID || record.Envelope.HostID != p.HostID {
		return errors.New("copy worker has no approved payload")
	}
	e := *record.Envelope
	if e.Action != "copy" && e.Action != "publish" {
		return errors.New("copy action denied")
	}
	if err = copyLeaseCurrent(id); err != nil {
		return err
	}
	_, err = fileOperation(e, p, p.Actors[strconv.Itoa(e.ActorID)])
	return err
}
func copyLeaseCurrent(id string) error {
	lease, err := readCopyLease(id)
	if err != nil {
		return err
	}
	if lease.State != "running" || lease.Until < time.Now().UnixMilli() || lease.Deadline < time.Now().UnixMilli() {
		return errors.New("copy lease expired before publication")
	}
	return nil
}
func renewCopy(e Envelope) (map[string]any, error) {
	id := str(e.Params, "operationId")
	guard, err := namedLock("lease-" + id)
	if err != nil {
		return nil, err
	}
	defer guard.Close()
	lease, err := readCopyLease(id)
	if err != nil {
		return nil, err
	}
	if lease.ActorID != e.ActorID || lease.PolicyHash != e.PolicyHash {
		return nil, errors.New("copy belongs to another actor")
	}
	if lease.State == "published" {
		return map[string]any{"ok": true}, nil
	}
	if err = copyLeaseCurrent(id); err != nil {
		return nil, err
	}
	lease.Until = time.Now().Add(time.Duration(lease.LeaseSeconds) * time.Second).UnixMilli()
	if lease.Until > lease.Deadline {
		lease.Until = lease.Deadline
	}
	return map[string]any{"ok": true}, atomicJSON(copyLeasePath(id), lease)
}

// Publication and lease expiry serialize on a separate lock. A watchdog cannot
// label a completed rename as a cancelled private copy, and an expired worker
// cannot publish after cancellation/authority loss.
func copyPublication(id string, fn func() error) error {
	if !(len(os.Args) == 3 && os.Args[1] == "copy-operation" && os.Args[2] == id) {
		return fn()
	}
	guard, err := namedLock("lease-" + id)
	if err != nil {
		return err
	}
	defer guard.Close()
	if err = copyLeaseCurrent(id); err != nil {
		return err
	}
	lease, err := readCopyLease(id)
	if err != nil {
		return err
	}
	lease.State = "publishing"
	if err = atomicJSON(copyLeasePath(id), lease); err != nil {
		return err
	}
	if err = fn(); err != nil {
		return err
	}
	lease, err = readCopyLease(id)
	if err != nil {
		return err
	}
	lease.State = "published"
	return atomicJSON(copyLeasePath(id), lease)
}
func expireCopies() error {
	entries, err := boundedEntries(filepath.Join(statePath, "leases"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !uuid.MatchString(id) {
			continue
		}
		guard, err := namedLock("lease-" + id)
		if err != nil {
			continue
		}
		lease, err := readCopyLease(id)
		expired := err == nil && lease.State == "running" && (lease.Until < time.Now().UnixMilli() || lease.Deadline < time.Now().UnixMilli())
		if expired {
			lease.State = "expired"
			err = atomicJSON(copyLeasePath(id), lease)
		}
		guard.Close()
		if expired && err == nil {
			_, _ = boundedCommand("/bin/systemctl", "stop", "omnilodge-copy-"+id+".service")
		}
	}
	return nil
}
