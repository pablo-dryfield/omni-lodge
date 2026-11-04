package main

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
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
	entries, err := os.ReadDir(filepath.Join(statePath, "nonces"))
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
	records, err := os.ReadDir(filepath.Join(statePath, "operations"))
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
		}
		guard.Close()
	}
	seen := map[string]bool{}
	for actorID, actor := range p.Actors {
		for rootID, policy := range actor.Roots {
			if !policy.Writable || seen[policy.Path] {
				continue
			}
			seen[policy.Path] = true
			guard, lockErr := namedLock(rootID)
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
	return nil
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
