package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Invoked only by the root timer, with no caller-selected filesystem paths.
// Active and uncertain operation records are retained for reconciliation.
func cleanup(p Policy) error {
	now := time.Now()
	authorityLock, err := globalLock()
	if err != nil {
		return err
	}
	entries, err := boundedEntries(filepath.Join(statePath, "nonces"))
	if err != nil {
		authorityLock.Close()
		return err
	}
	for i, entry := range entries {
		if i >= 10000 {
			break
		}
		if !uuid.MatchString(entry.Name()) {
			continue
		}
		info, statErr := entry.Info()
		if statErr == nil && info.Mode().IsRegular() && info.ModTime().Before(now.Add(-2*time.Minute)) {
			_ = os.Remove(filepath.Join(statePath, "nonces", entry.Name()))
		}
	}
	authorityLock.Close()
	records, err := boundedEntries(filepath.Join(statePath, "operations"))
	if err != nil {
		return err
	}
	for i, entry := range records {
		if i >= 10000 {
			break
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !uuid.MatchString(id) {
			continue
		}
		info, statErr := entry.Info()
		if statErr != nil {
			continue
		}
		guard, lockErr := namedLock(id)
		if lockErr != nil {
			continue
		}
		record, readErr := loadRecord(id)
		if readErr == nil && (record.State == "completed" || record.State == "stopped") && ((record.ExpiresAt > 0 && record.ExpiresAt < now.UnixMilli()) || (record.ExpiresAt == 0 && info.ModTime().Before(now.Add(-30*24*time.Hour)))) {
			_ = os.Remove(recordPath(id))
			_ = os.Remove(copyLeasePath(id))
		}
		guard.Close()
	}
	seen := map[string]bool{}
	for actorID, actor := range p.Actors {
		for rootID, policy := range actor.Roots {
			key := policy.Path + ":" + actorID
			if !policy.Writable || seen[key] {
				continue
			}
			seen[key] = true
			guard, lockErr := namedLock("root-" + rootID)
			if lockErr != nil {
				continue
			}
			err = cleanupRootTrash(policy, rootID, actorID, now)
			guard.Close()
			if err != nil {
				return err
			}
		}
	}
	return cleanupStaging(p, now)
}
func cleanupRootTrash(policy RootPolicy, rootID, actorID string, now time.Time) error {
	root, err := os.OpenRoot(policy.Path)
	if err != nil {
		return err
	}
	defer root.Close()
	directory, err := root.Open(".omnilodge-trash")
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	entries, err := directory.ReadDir(2001)
	directory.Close()
	if err != nil && err != io.EOF {
		return err
	}
	if len(entries) > 2000 {
		return errors.New("trash cleanup inventory exceeded")
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".metadata.json")
		if !uuid.MatchString(id) || !strings.HasSuffix(entry.Name(), ".metadata.json") {
			continue
		}
		name := filepath.Join(".omnilodge-trash", entry.Name())
		if err = noLinks(root, name, false); err != nil {
			return err
		}
		info, err := root.Lstat(name)
		if err != nil || info.Size() > 8192 {
			continue
		}
		data, err := root.ReadFile(name)
		if err != nil {
			continue
		}
		var metadata struct {
			ActorID int    `json:"actorId"`
			RootID  string `json:"rootId"`
			Entry   string `json:"entry"`
			Expires int64  `json:"expires"`
		}
		if json.Unmarshal(data, &metadata) != nil || metadata.RootID != rootID || metadata.Entry != filepath.Join(".omnilodge-trash", id) || metadata.Expires <= 0 || metadata.Expires > now.UnixMilli() {
			continue
		}
		// A policy root may be shared, but cleanup follows only root-created UUID
		// metadata; it never interprets the original customer-controlled filename.
		if err = root.RemoveAll(metadata.Entry); err != nil {
			return err
		}
		if err = root.Remove(name); err != nil {
			return err
		}
	}
	return nil
}

type StagingRecord struct {
	ID      string `json:"id"`
	ActorID int    `json:"actorId"`
	RootID  string `json:"rootId"`
	Expires int64  `json:"expires"`
	Parent  string `json:"parent,omitempty"`
}

func registerStaging(e Envelope, p Policy) (map[string]any, error) {
	admission, err := namedLock("staging-admission")
	if err != nil {
		return nil, err
	}
	defer admission.Close()
	id := str(e.Params, "stagingId")
	rootID := str(e.Params, "rootId")
	actor := p.Actors[strconv.Itoa(e.ActorID)]
	root, ok := actor.Roots[rootID]
	if !ok || !root.Writable || root.Staging == "" || !uuid.MatchString(id) {
		return nil, errors.New("staging registration rejected")
	}
	deadline := int64(integer(e.Params, "stagingExpiresAt"))
	if deadline < time.Now().UnixMilli() || deadline > time.Now().Add(7*24*time.Hour+time.Minute).UnixMilli() {
		return nil, errors.New("invalid staging expiry")
	}
	directory := filepath.Join(statePath, "staging")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, err
	}
	file := filepath.Join(directory, id+".json")
	if _, err := os.Lstat(file); err == nil {
		return nil, errors.New("staging already registered")
	}
	dir, err := os.Open(directory)
	if err != nil {
		return nil, err
	}
	entries, err := dir.ReadDir(10001)
	dir.Close()
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(entries) >= 10000 {
		return nil, errors.New("staging journal quota reached")
	}
	parent := ""
	if root.Privileged {
		name, pathErr := safePath(str(e.Params, "path"))
		if pathErr != nil {
			return nil, pathErr
		}
		if pathErr = rootMutationPath(root, name); pathErr != nil {
			return nil, pathErr
		}
		parent = filepath.Dir(name)
	}
	return map[string]any{"registered": true}, atomicJSON(file, StagingRecord{ID: id, ActorID: e.ActorID, RootID: rootID, Expires: deadline, Parent: parent})
}
func cleanupStaging(p Policy, now time.Time) error {
	directory := filepath.Join(statePath, "staging")
	dir, err := os.Open(directory)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	entries, err := dir.ReadDir(10001)
	dir.Close()
	if err != nil && err != io.EOF {
		return err
	}
	if len(entries) > 10000 {
		return errors.New("staging inventory quota exceeded")
	}
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !uuid.MatchString(id) {
			continue
		}
		file := filepath.Join(directory, entry.Name())
		b, err := os.ReadFile(file)
		if err != nil || len(b) > 8192 {
			continue
		}
		var record StagingRecord
		if json.Unmarshal(b, &record) != nil || record.ID != id || record.Expires > now.UnixMilli() {
			continue
		}
		actor, ok := p.Actors[strconv.Itoa(record.ActorID)]
		if !ok {
			continue
		}
		policy, ok := actor.Roots[record.RootID]
		if !ok || !policy.Writable {
			continue
		}
		guard, err := namedLock("root-" + record.RootID)
		if err != nil {
			continue
		}
		// Expire the lease first. An uncertain publishing worker retains its records and files.
		lease, leaseErr := readCopyLease(id)
		if leaseErr == nil && (lease.State == "publishing" || (lease.State == "running" && lease.Until > now.UnixMilli())) {
			guard.Close()
			continue
		}
		// Keep the root-owned record until every owned file is confirmed absent.
		// A failed removal must remain retryable by the next timer invocation.
		err = removeStagingFiles(policy, id, record.Parent)
		if err == nil {
			err = os.Remove(file)
		}
		guard.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func removeStagingFiles(policy RootPolicy, id string, parents ...string) error {
	private := ".omnilodge-private"
	if policy.Privileged && len(parents) > 0 && parents[0] != "" {
		parent, err := safePath(parents[0])
		if err != nil {
			return err
		}
		private = filepath.Join(parent, private)
	}
	for _, location := range []struct{ base, name string }{{policy.Staging, id}, {policy.Path, filepath.Join(private, id+".partial")}, {policy.Path, filepath.Join(private, id+".copy")}} {
		root, err := os.OpenRoot(location.base)
		if err != nil {
			return err
		}
		info, err := root.Lstat(location.name)
		if os.IsNotExist(err) {
			root.Close()
			continue
		}
		if err == nil && !info.Mode().IsRegular() {
			err = errors.New("owned staging entry is not a regular file")
		}
		if err == nil {
			err = noLinks(root, location.name, false)
		}
		if err == nil {
			err = root.Remove(location.name)
		}
		root.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
