package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

func safePath(value string) (string, error) {
	if value == "" {
		value = "."
	}
	if filepath.IsAbs(value) || strings.HasPrefix(value, "/") || strings.ContainsAny(value, "\x00\\") || len(value) > 4096 {
		return "", errors.New("invalid relative path")
	}
	for _, part := range strings.Split(value, "/") {
		if part == ".." || strings.HasPrefix(part, ".omnilodge-") {
			return "", errors.New("parent traversal denied")
		}
	}
	return filepath.Clean(value), nil
}
func noLinks(root *os.Root, name string, missingLast bool) error {
	parts := strings.Split(name, string(os.PathSeparator))
	current := "."
	for i, part := range parts {
		if part == "." || part == "" {
			continue
		}
		current = filepath.Join(current, part)
		info, err := root.Lstat(current)
		if err != nil {
			if missingLast && i == len(parts)-1 && os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || (!info.IsDir() && !info.Mode().IsRegular()) {
			return errors.New("symlink or special-file access denied")
		}
		if info.Mode().IsRegular() && hardlinks(info) != 1 {
			return errors.New("multiply linked file denied")
		}
	}
	return nil
}
func fileFingerprint(info os.FileInfo) string {
	return fmt.Sprintf("%d:%d:%d:%d:%d", info.Size(), info.ModTime().Unix(), modeBits(info), uid(info), gid(info))
}
func currentVersion(root *os.Root, name string) (string, error) {
	info, err := root.Lstat(name)
	if err != nil {
		return "", err
	}
	return fileFingerprint(info), nil
}
func fileOperation(e Envelope, p Policy, actor Actor) (map[string]any, error) {
	rootID := str(e.Params, "rootId")
	policy, ok := actor.Roots[rootID]
	if !ok || !identifier.MatchString(rootID) {
		return nil, errors.New("file root not approved")
	}
	if e.Action == "statvfs" {
		return diskInfo(policy.Path)
	}
	root, err := os.OpenRoot(policy.Path)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	if e.Action == "trashList" {
		directory, openErr := root.Open(".omnilodge-trash")
		if os.IsNotExist(openErr) {
			return map[string]any{"entries": []any{}}, nil
		}
		if openErr != nil {
			return nil, openErr
		}
		defer directory.Close()
		entries, readErr := directory.ReadDir(1001)
		if readErr != nil && readErr != io.EOF {
			return nil, readErr
		}
		if len(entries) > 1000 {
			return nil, errors.New("trash inventory limit exceeded")
		}
		result := []map[string]any{}
		for _, entry := range entries {
			if !strings.HasSuffix(entry.Name(), ".metadata.json") {
				continue
			}
			b, readErr := root.ReadFile(filepath.Join(".omnilodge-trash", entry.Name()))
			if readErr != nil || len(b) > 8192 {
				continue
			}
			var metadata map[string]any
			if json.Unmarshal(b, &metadata) != nil || intValue(metadata["actorId"]) != e.ActorID {
				continue
			}
			metadata["trashId"] = strings.TrimSuffix(entry.Name(), ".metadata.json")
			result = append(result, metadata)
		}
		return map[string]any{"entries": result}, nil
	}
	name, err := safePath(str(e.Params, "path"))
	if err != nil {
		return nil, err
	}
	if e.Action == "checksum" {
		if err = noLinks(root, name, false); err != nil {
			return nil, err
		}
		f, err := root.Open(name)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		h := sha256.New()
		_, err = io.Copy(h, f)
		return map[string]any{"sha256": hex.EncodeToString(h.Sum(nil))}, err
	}
	if !policy.Writable {
		return nil, errors.New("root is read-only")
	}
	if name == "." {
		return nil, errors.New("cannot mutate the root itself")
	}
	allowed := map[string]bool{"publish": true, "mkdir": true, "rename": true, "copy": true, "trash": true, "delete": true, "restore": true, "chmod": true}
	if !allowed[e.Action] {
		return nil, errors.New("unsupported managed operation")
	}
	id := str(e.Params, "operationId")
	return journaled(e, id, func() (map[string]any, error) {
		pathLock, err := namedLock(rootID)
		if err != nil {
			return nil, err
		}
		defer pathLock.Close()
		if e.Action == "publish" && boolean(e.Params, "createParents") {
			parts := strings.Split(filepath.Dir(name), string(os.PathSeparator))
			current := "."
			for _, part := range parts {
				current = filepath.Join(current, part)
				if err = noLinks(root, current, true); err != nil {
					return nil, err
				}
				if err = root.MkdirAll(current, 0750); err != nil {
					return nil, err
				}
			}
		}
		if err = noLinks(root, name, e.Action == "publish" || e.Action == "mkdir" || e.Action == "restore"); err != nil {
			return nil, err
		}
		expected := str(e.Params, "source")
		if expected != "" {
			actual, err := currentVersion(root, name)
			if err != nil || actual != expected {
				return nil, errors.New("source version changed since review")
			}
		}
		result := map[string]any{"ok": true, "operationId": id}
		switch e.Action {
		case "mkdir":
			err = root.Mkdir(name, 0750)
		case "chmod":
			mode := integer(e.Params, "mode")
			if mode < 0 || mode > 0777 || mode&0022 != 0 {
				return nil, errors.New("managed entries cannot grant group or other write access; publish through staging")
			}
			f, openErr := root.Open(name)
			if openErr != nil {
				return nil, openErr
			}
			defer f.Close()
			err = f.Chmod(os.FileMode(mode))
		case "rename":
			target, checkErr := safePath(str(e.Params, "target"))
			if checkErr != nil {
				return nil, checkErr
			}
			if err = noLinks(root, target, true); err != nil {
				return nil, err
			}
			if _, statErr := root.Lstat(target); !os.IsNotExist(statErr) {
				return nil, errors.New("destination already exists")
			}
			err = root.Rename(name, target)
		case "publish":
			return publish(e, p, policy, root, name, id)
		case "copy":
			target, checkErr := safePath(str(e.Params, "target"))
			if checkErr != nil {
				return nil, checkErr
			}
			if err = noLinks(root, target, true); err != nil {
				return nil, err
			}
			info, statErr := root.Lstat(name)
			if statErr != nil {
				return nil, statErr
			}
			if !info.Mode().IsRegular() {
				return nil, errors.New("copy directories through a reviewed comparison manifest")
			}
			err = atomicCopy(root, name, target, id, policy, p.ReserveBytes, p.ReservePercent)
		case "trash":
			hash, count, size, scanErr := treeSnapshot(root, name)
			if scanErr != nil {
				return nil, scanErr
			}
			if boolean(e.Params, "recursive") && (hash != str(e.Params, "manifestHash") || count != integer(e.Params, "manifestCount")) {
				return nil, errors.New("directory contents changed since review")
			}
			budget := integer(e.Params, "trashBytes")
			if budget < 1 || budget > 256<<20 {
				budget = 256 << 20
			}
			if err = root.MkdirAll(".omnilodge-trash", 0700); err != nil {
				return nil, err
			}
			_, _, used, scanErr := treeSnapshot(root, ".omnilodge-trash")
			if scanErr != nil {
				return nil, scanErr
			}
			if size+used > int64(budget) {
				return nil, errors.New("trash quota exceeded; remove expired trash or explicitly review permanent deletion")
			}
			days := integer(e.Params, "trashDays")
			if days < 1 || days > 30 {
				days = 7
			}
			destination := filepath.Join(".omnilodge-trash", id)
			metadata := map[string]any{"actorId": e.ActorID, "rootId": rootID, "original": name, "entry": destination, "bytes": size, "expires": time.Now().Add(time.Duration(days) * 24 * time.Hour).UnixMilli()}
			b, _ := json.Marshal(metadata)
			if err = root.WriteFile(destination+".metadata.json", b, 0600); err != nil {
				return nil, err
			}
			err = root.Rename(name, destination)
			result["trashId"] = id
		case "restore":
			trashID := str(e.Params, "trashId")
			if !uuid.MatchString(trashID) {
				return nil, errors.New("invalid trash identity")
			}
			b, readErr := root.ReadFile(filepath.Join(".omnilodge-trash", trashID+".metadata.json"))
			if readErr != nil {
				return nil, readErr
			}
			var meta struct {
				ActorID  int    `json:"actorId"`
				Original string `json:"original"`
			}
			if err = json.Unmarshal(b, &meta); err != nil {
				return nil, err
			}
			if meta.ActorID != e.ActorID || meta.Original != name {
				return nil, errors.New("trash ownership mismatch")
			}
			if _, statErr := root.Lstat(name); !os.IsNotExist(statErr) {
				return nil, errors.New("restore destination exists")
			}
			err = root.Rename(filepath.Join(".omnilodge-trash", trashID), name)
		case "delete":
			info, statErr := root.Lstat(name)
			if statErr != nil {
				return nil, statErr
			}
			if info.IsDir() {
				hash, count, _, scanErr := treeSnapshot(root, name)
				if scanErr != nil {
					return nil, scanErr
				}
				if !boolean(e.Params, "recursive") || hash != str(e.Params, "manifestHash") || count != integer(e.Params, "manifestCount") {
					return nil, errors.New("recursive deletion requires an unchanged reviewed inventory")
				}
				err = root.RemoveAll(name)
				result["removedEntries"] = count
			} else {
				err = root.Remove(name)
			}
		}
		return result, err
	})
}
func publish(e Envelope, p Policy, policy RootPolicy, root *os.Root, name, id string) (map[string]any, error) {
	stagingID := str(e.Params, "stagingId")
	if !uuid.MatchString(stagingID) {
		return nil, errors.New("invalid staging identity")
	}
	staging, err := os.OpenRoot(policy.Staging)
	if err != nil {
		return nil, err
	}
	defer staging.Close()
	if err = noLinks(staging, stagingID, false); err != nil {
		return nil, err
	}
	source, err := staging.Open(stagingID)
	if err != nil {
		return nil, err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil || !info.Mode().IsRegular() || hardlinks(info) != 1 {
		return nil, errors.New("invalid staged file")
	}
	var expectedSize int64
	_ = json.Unmarshal(e.Params["size"], &expectedSize)
	expectedHash := str(e.Params, "sha256")
	if info.Size() != expectedSize || expectedSize < 0 || expectedSize > 10<<30 || len(expectedHash) != 64 {
		return nil, errors.New("staged size or hash mismatch")
	}
	capacity, err := diskInfo(policy.Path)
	if err != nil {
		return nil, err
	}
	reserve := max(uint64(p.ReserveBytes), capacity["totalBytes"].(uint64)*uint64(p.ReservePercent)/100)
	if capacity["freeBytes"].(uint64) < uint64(expectedSize)+reserve {
		return nil, errors.New("destination capacity reserve would be exceeded")
	}
	if err = root.MkdirAll(".omnilodge-private", 0700); err != nil {
		return nil, err
	}
	temporary := filepath.Join(".omnilodge-private", id+".partial")
	target, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	count, err := io.Copy(io.MultiWriter(target, h), io.LimitReader(source, expectedSize+1))
	if err == nil && count != expectedSize {
		err = errors.New("staged file changed while copying")
	}
	actual := hex.EncodeToString(h.Sum(nil))
	if err == nil && actual != expectedHash {
		err = errors.New("staged checksum mismatch")
	}
	if err == nil {
		err = target.Sync()
	}
	if err == nil {
		mode := os.FileMode(0640)
		if !boolean(e.Params, "createOnly") {
			if previous, statErr := root.Lstat(name); statErr == nil {
				if previous.Mode().Perm()&0022 != 0 {
					err = errors.New("destination has unmanaged writable permissions")
				}
				mode = previous.Mode().Perm()
			}
		}
		if err == nil {
			err = target.Chmod(mode)
		}
	}
	if err == nil {
		err = target.Chown(0, policy.GID)
	}
	closeErr := target.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	// The private copy has no uploader-owned writable descriptor. Recheck under the root publication lock.
	if expected := str(e.Params, "originalSha256"); expected != "" {
		old, openErr := root.Open(name)
		if openErr != nil {
			return nil, openErr
		}
		oldHash := sha256.New()
		_, readErr := io.Copy(oldHash, old)
		_ = old.Close()
		if readErr != nil || hex.EncodeToString(oldHash.Sum(nil)) != expected {
			return nil, errors.New("destination content changed before publication")
		}
	}
	if expected := str(e.Params, "source"); expected != "" {
		version, err := currentVersion(root, name)
		if err != nil || version != expected {
			return nil, errors.New("destination changed before publication")
		}
	}
	if boolean(e.Params, "createOnly") {
		if _, statErr := root.Lstat(name); !os.IsNotExist(statErr) {
			return nil, errors.New("destination exists; explicit overwrite review required")
		}
	}
	if err = copyPublication(id, func() error {
		if err := root.Rename(temporary, name); err != nil {
			return err
		}
		dir, err := root.Open(filepath.Dir(name))
		if err != nil {
			return err
		}
		defer dir.Close()
		return dir.Sync()
	}); err != nil {
		return nil, err
	}
	_ = staging.Remove(stagingID)
	return map[string]any{"ok": true, "sha256": actual, "bytes": count, "operationId": id}, nil
}

func intValue(value any) int {
	n, ok := value.(float64)
	if !ok {
		return -1
	}
	return int(n)
}

// The published name is created only after a private, verified, fsynced copy.
func atomicCopy(root *os.Root, name, target, id string, policy RootPolicy, reserve int64, reservePercent int) error {
	info, err := root.Lstat(name)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || hardlinks(info) != 1 {
		return errors.New("copy source is not a singly-linked regular file")
	}
	if _, err = root.Lstat(target); !os.IsNotExist(err) {
		return errors.New("destination already exists")
	}
	capacity, err := diskInfo(policy.Path)
	if err != nil {
		return err
	}
	if info.Size() > 10<<30 || capacity["freeBytes"].(uint64) < uint64(info.Size())+max(uint64(reserve), capacity["totalBytes"].(uint64)*uint64(reservePercent)/100) {
		return errors.New("copy exceeds destination reserve")
	}
	if err = root.MkdirAll(".omnilodge-private", 0700); err != nil {
		return err
	}
	temporary := filepath.Join(".omnilodge-private", id+".copy")
	defer root.Remove(temporary)
	source, err := root.Open(name)
	if err != nil {
		return err
	}
	defer source.Close()
	destination, err := root.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	count, err := io.Copy(io.MultiWriter(destination, hash), io.LimitReader(source, info.Size()+1))
	if err == nil && count != info.Size() {
		err = errors.New("source size changed while copying")
	}
	if err == nil {
		err = destination.Sync()
	}
	if err == nil {
		err = destination.Chmod(0640)
	}
	if err == nil {
		err = destination.Chown(0, policy.GID)
	}
	closeErr := destination.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	current, err := root.Lstat(name)
	if err != nil || !os.SameFile(info, current) || fileFingerprint(info) != fileFingerprint(current) {
		return errors.New("source identity changed while copying")
	}
	check, err := root.Open(name)
	if err != nil {
		return err
	}
	verify := sha256.New()
	_, err = io.Copy(verify, check)
	check.Close()
	if err != nil {
		return err
	}
	if !strings.EqualFold(hex.EncodeToString(hash.Sum(nil)), hex.EncodeToString(verify.Sum(nil))) {
		return errors.New("source content changed while copying")
	}
	if _, err = root.Lstat(target); !os.IsNotExist(err) {
		return errors.New("destination appeared before publication")
	}
	return copyPublication(id, func() error {
		if err := root.Rename(temporary, target); err != nil {
			return err
		}
		directory, err := root.Open(filepath.Dir(target))
		if err != nil {
			return err
		}
		defer directory.Close()
		return directory.Sync()
	})
}

// Metadata inventory is bounded and link-free. The adapter serializes managed
// mutations on the root, then rebuilds this digest before recursive changes.
func treeSnapshot(root *os.Root, name string) (string, int, int64, error) {
	rows := []string{}
	var bytes int64
	base, err := root.Lstat(name)
	if err != nil {
		return "", 0, 0, err
	}
	if base.Mode().IsRegular() {
		if hardlinks(base) != 1 {
			return "", 0, 0, errors.New("hard link denied")
		}
		return "", 0, base.Size(), nil
	}
	if !base.IsDir() {
		return "", 0, 0, errors.New("special file denied")
	}
	var visit func(string, int) error
	visit = func(current string, depth int) error {
		if depth > 32 {
			return errors.New("inventory depth exceeded")
		}
		dir, err := root.Open(current)
		if err != nil {
			return err
		}
		entries, err := dir.ReadDir(10001)
		dir.Close()
		if err != nil && err != io.EOF {
			return err
		}
		if len(entries) > 10000 {
			return errors.New("inventory size exceeded")
		}
		for _, entry := range entries {
			if len(rows) >= 10000 {
				return errors.New("inventory size exceeded")
			}
			if strings.HasPrefix(entry.Name(), ".omnilodge-") {
				return errors.New("protected internal path in recursive scope")
			}
			p := filepath.Join(current, entry.Name())
			if err = noLinks(root, p, false); err != nil {
				return err
			}
			info, err := root.Lstat(p)
			if err != nil {
				return err
			}
			kind := "file"
			if info.IsDir() {
				kind = "directory"
			} else {
				bytes += info.Size()
			}
			relative, _ := filepath.Rel(name, p)
			rows = append(rows, filepath.ToSlash(relative)+"\x00"+kind+"\x00"+fileFingerprint(info)+"\n")
			if info.IsDir() {
				if err = visit(p, depth+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err = visit(name, 0); err != nil {
		return "", 0, 0, err
	}
	sort.Strings(rows)
	hash := sha256.Sum256([]byte(strings.Join(rows, "")))
	return hex.EncodeToString(hash[:]), len(rows), bytes, nil
}
