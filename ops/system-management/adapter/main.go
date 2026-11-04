package main

import (
	"bufio"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const policyPath = "/etc/omnilodge-system/adapter.json"
const statePath = "/var/lib/omnilodge-system/host"

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type RootPolicy struct {
	Path       string `json:"path"`
	Staging    string `json:"staging"`
	Writable   bool   `json:"writable"`
	GID        int    `json:"gid"`
	Privileged bool   `json:"privileged,omitempty"`
}
type Actor struct {
	Username         string                `json:"username"`
	WorkingDirectory string                `json:"workingDirectory"`
	Roots            map[string]RootPolicy `json:"roots"`
	Services         []string              `json:"services"`
}
type Service struct {
	Name        string `json:"name"`
	Unit        string `json:"unit"`
	PM2Name     string `json:"pm2Name"`
	HealthKind  string `json:"healthKind"`
	Restartable bool   `json:"restartable"`
}
type Policy struct {
	ReservePercent int                `json:"reservePercent"`
	Version        int                `json:"version"`
	HostID         string             `json:"hostId"`
	PublicKey      string             `json:"publicKey"`
	Actors         map[string]Actor   `json:"actors"`
	Services       map[string]Service `json:"services"`
	MemoryMiB      int                `json:"memoryMiB"`
	CPUPercent     int                `json:"cpuPercent"`
	Tasks          int                `json:"tasks"`
	ReserveBytes   int64              `json:"reserveBytes"`
	LeaseSeconds   int                `json:"-"`
	RuntimeExpires int64              `json:"-"`
}
type Envelope struct {
	Version    int                        `json:"version"`
	ActorID    int                        `json:"actorId"`
	HostID     string                     `json:"hostId"`
	Action     string                     `json:"action"`
	Params     map[string]json.RawMessage `json:"params"`
	Nonce      string                     `json:"nonce"`
	Expires    int64                      `json:"expires"`
	PolicyHash string                     `json:"policyHash"`
}
type Record struct {
	ExpiresAt    int64          `json:"expiresAt,omitempty"`
	PolicyHash   string         `json:"policyHash,omitempty"`
	Deadline     int64          `json:"deadline,omitempty"`
	LeaseSeconds int            `json:"leaseSeconds,omitempty"`
	Envelope     *Envelope      `json:"envelope,omitempty"`
	PayloadHash  string         `json:"payloadHash"`
	ID           string         `json:"id"`
	ActorID      int            `json:"actorId"`
	Action       string         `json:"action"`
	Fence        int            `json:"fence"`
	State        string         `json:"state"`
	Result       map[string]any `json:"result,omitempty"`
	LeaseUntil   int64          `json:"leaseUntil,omitempty"`
	StopHash     string         `json:"stopHash,omitempty"`
	ServiceID    string         `json:"serviceId,omitempty"`
}

func output(value any) { _ = json.NewEncoder(os.Stdout).Encode(value) }
func fail(err error) {
	output(map[string]any{"error": err.Error(), "code": "REMOTE_REJECTED"})
	os.Exit(1)
}
func str(p map[string]json.RawMessage, key string) string {
	var value string
	_ = json.Unmarshal(p[key], &value)
	return value
}
func integer(p map[string]json.RawMessage, key string) int {
	var value int
	_ = json.Unmarshal(p[key], &value)
	return value
}
func boolean(p map[string]json.RawMessage, key string) bool {
	var value bool
	_ = json.Unmarshal(p[key], &value)
	return value
}
func loadPolicy() (Policy, error) {
	var p Policy
	if err := protectedFile(policyPath); err != nil {
		return p, err
	}
	b, err := os.ReadFile(policyPath)
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal(b, &p); err != nil {
		return p, err
	}
	if p.Version != 1 || !identifier.MatchString(p.HostID) || p.MemoryMiB < 32 || p.MemoryMiB > 256 || p.CPUPercent < 1 || p.CPUPercent > 25 || p.Tasks < 4 || p.Tasks > 64 || p.ReserveBytes < 1<<30 {
		return p, errors.New("invalid root-owned host policy")
	}
	if p.ReservePercent < 15 {
		p.ReservePercent = 15
	}
	return p, nil
}
func verify(ticket string, p Policy, now time.Time) (Envelope, error) {
	var e Envelope
	parts := strings.Split(ticket, ".")
	if len(parts) != 2 {
		return e, errors.New("invalid authorization envelope")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(payload) > 65536 {
		return e, errors.New("invalid authorization payload")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return e, err
	}
	key, err := base64.StdEncoding.DecodeString(p.PublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, payload, signature) {
		return e, errors.New("authorization signature rejected")
	}
	if err = json.Unmarshal(payload, &e); err != nil {
		return e, err
	}
	if e.Version != 1 || e.HostID != p.HostID || e.ActorID < 1 || !uuid.MatchString(e.Nonce) || e.Expires < now.UnixMilli() || e.Expires > now.Add(35*time.Second).UnixMilli() {
		return e, errors.New("authorization expired or target mismatch")
	}
	if _, ok := p.Actors[strconv.Itoa(e.ActorID)]; !ok {
		return e, errors.New("actor is not enrolled")
	}
	return e, nil
}
func atomicJSON(name string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(name), ".state-")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(tmp, name); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(name))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func lockIdentity(name string) (string, error) {
	category := ""
	value := name
	if name == "authority" || name == "copy-admission" || name == "journal-admission" || name == "staging-admission" {
		return name, nil
	}
	if uuid.MatchString(name) {
		category = "operation"
	} else if strings.HasPrefix(name, "lease-") && uuid.MatchString(strings.TrimPrefix(name, "lease-")) {
		category = "lease"
		value = strings.TrimPrefix(name, "lease-")
	} else if strings.HasPrefix(name, "root-") && identifier.MatchString(strings.TrimPrefix(name, "root-")) {
		category = "root"
		value = strings.TrimPrefix(name, "root-")
	} else {
		return "", errors.New("invalid lock identity")
	}
	sum := sha256.Sum256([]byte(value))
	return category + "-" + hex.EncodeToString(sum[:1]), nil
}
func boundedEntries(directory string) ([]os.DirEntry, error) {
	dir, err := os.Open(directory)
	if err != nil {
		return nil, err
	}
	defer dir.Close()
	entries, err := dir.ReadDir(10001)
	if err != nil && err != io.EOF {
		return nil, err
	}
	if len(entries) > 10000 {
		return nil, errors.New("root journal quota exceeded")
	}
	return entries, nil
}
func consume(nonce string) error {
	if entries, err := boundedEntries(filepath.Join(statePath, "nonces")); err != nil || len(entries) >= 10000 {
		return errors.New("nonce quota exceeded; wait for owned cleanup")
	}
	f, err := os.OpenFile(filepath.Join(statePath, "nonces", nonce), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("authorization nonce already consumed or journal unavailable")
	}
	defer f.Close()
	_, err = f.WriteString(strconv.FormatInt(time.Now().Unix(), 10))
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Join(statePath, "nonces"))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
func recordPath(id string) string { return filepath.Join(statePath, "operations", id+".json") }
func loadRecord(id string) (Record, error) {
	var r Record
	if !uuid.MatchString(id) {
		return r, errors.New("invalid operation identity")
	}
	b, err := os.ReadFile(recordPath(id))
	if err != nil {
		return r, err
	}
	err = json.Unmarshal(b, &r)
	return r, err
}
func boundedCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8", "HOME=/root", "PM2_HOME=/root/.pm2"}
	out := &limitedBuffer{limit: 2 << 20}
	cmd.Stdout = out
	cmd.Stderr = out
	if err := cmd.Start(); err != nil {
		return "", err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		return out.String(), err
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		<-done
		return out.String(), errors.New("operation timed out; outcome requires verification")
	}
}

type limitedBuffer struct {
	data  []byte
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if len(b.data)+len(p) > b.limit {
		return 0, errors.New("output limit exceeded")
	}
	b.data = append(b.data, p...)
	return len(p), nil
}
func (b *limitedBuffer) String() string { return string(b.data) }
func unit(id string) string             { return "omnilodge-console-" + id + ".service" }
func stopRecord(r Record) error {
	guard, err := namedLock(r.ID)
	if err != nil {
		return err
	}
	defer guard.Close()
	latest, err := loadRecord(r.ID)
	if err != nil {
		return err
	}
	return stopUnlocked(latest)
}
func stopUnlocked(r Record) error {
	_, err := boundedCommand("/bin/systemctl", "stop", unit(r.ID))
	r.State = "closed"
	r.LeaseUntil = 0
	if saveErr := atomicJSON(recordPath(r.ID), r); err == nil {
		err = saveErr
	}
	return err
}
func stopCapability(line string) error {
	var input struct {
		Stop       string `json:"stop"`
		Capability string `json:"capability"`
	}
	if err := json.Unmarshal([]byte(line), &input); err != nil {
		return err
	}
	r, err := loadRecord(input.Stop)
	if err != nil {
		return err
	}
	h := sha256.Sum256([]byte(input.Capability))
	if r.StopHash == "" || subtle.ConstantTimeCompare([]byte(r.StopHash), []byte(hex.EncodeToString(h[:]))) != 1 {
		return errors.New("stop capability rejected")
	}
	return stopRecord(r)
}
func terminal(e Envelope, p Policy, input io.Reader, unlock func()) error {
	id := str(e.Params, "sessionId")
	entries, readErr := boundedEntries(filepath.Join(statePath, "operations"))
	if readErr != nil {
		return readErr
	}
	active, owned := 0, 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		record, err := loadRecord(strings.TrimSuffix(entry.Name(), ".json"))
		if err == nil && record.Action == "terminal" && record.State == "active" && record.LeaseUntil > time.Now().UnixMilli() {
			active++
			if record.ActorID == e.ActorID {
				owned++
			}
		}
	}
	if active >= 4 || owned >= 2 {
		return errors.New("managed terminal admission limit reached")
	}
	if !uuid.MatchString(id) {
		return errors.New("invalid terminal identity")
	}
	actor := p.Actors[strconv.Itoa(e.ActorID)]
	if !identifier.MatchString(actor.Username) || actor.Username == "root" || !filepath.IsAbs(actor.WorkingDirectory) {
		return errors.New("invalid execution identity")
	}
	identity, lookupErr := user.Lookup(actor.Username)
	if lookupErr != nil || identity.Uid == "0" {
		return errors.New("execution identity must have a nonzero UID")
	}
	if _, err := os.Stat(recordPath(id)); err == nil {
		return errors.New("terminal session already exists")
	}
	stop := str(e.Params, "stopCapability")
	if len(stop) != 43 {
		return errors.New("invalid stop capability")
	}
	h := sha256.Sum256([]byte(stop))
	r := Record{ID: id, ActorID: e.ActorID, Action: "terminal", State: "active", ExpiresAt: int64(integer(e.Params, "metadataExpiresAt")), LeaseUntil: time.Now().Add(time.Duration(p.LeaseSeconds) * time.Second).UnixMilli(), PolicyHash: e.PolicyHash, Deadline: p.RuntimeExpires, LeaseSeconds: p.LeaseSeconds, StopHash: hex.EncodeToString(h[:])}
	if err := createRecord(r); err != nil {
		return err
	}
	unlock()
	args := []string{"--unit=" + unit(id), "--collect", "--wait", "--pty", "--uid=" + actor.Username, "--working-directory=" + actor.WorkingDirectory, "--property=Type=exec", "--property=NoNewPrivileges=yes", "--property=KillMode=control-group", "--property=TimeoutStopSec=5s", "--property=RuntimeMaxSec=" + strconv.Itoa(max(1, min(7200, int((p.RuntimeExpires-time.Now().UnixMilli())/1000)))) + "s", "--property=MemoryMax=" + strconv.Itoa(p.MemoryMiB) + "M", "--property=CPUQuota=" + strconv.Itoa(p.CPUPercent) + "%", "--property=TasksMax=" + strconv.Itoa(p.Tasks), "--property=Slice=omnilodge-console.slice", "--property=Delegate=no", "--setenv=TERM=xterm-256color", "--setenv=LANG=C.UTF-8", "--setenv=PATH=/usr/bin:/bin", "--", "/bin/bash", "--noprofile", "--norc", "-i"}
	cmd := exec.Command("/usr/bin/systemd-run", args...)
	cmd.Stdin = input
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = []string{"PATH=/usr/bin:/bin", "TERM=xterm-256color", "LANG=C.UTF-8"}
	err := cmd.Run()
	_ = stopRecord(r)
	return err
}
func watchdog() error {
	entries, err := boundedEntries(filepath.Join(statePath, "operations"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		r, err := loadRecord(id)
		if err != nil {
			continue
		}
		if r.Action == "terminal" && r.State == "active" && r.LeaseUntil < time.Now().UnixMilli() {
			guard, lockErr := namedLock(r.ID)
			if lockErr != nil {
				continue
			}
			latest, readErr := loadRecord(r.ID)
			if readErr == nil && latest.State == "active" && latest.LeaseUntil < time.Now().UnixMilli() {
				_ = stopUnlocked(latest)
			}
			_ = guard.Close()
		}
	}
	return expireCopies()
}
func dispatch(e Envelope, p Policy) (map[string]any, error) {
	actor := p.Actors[strconv.Itoa(e.ActorID)]
	if err := rootCapability(e, actor); err != nil {
		return nil, err
	}
	if e.Action == "registerStaging" {
		return registerStaging(e, p)
	}
	if e.Action == "renewOperation" {
		return renewCopy(e)
	}
	if e.Action == "publish" || e.Action == "copy" {
		return queueCopy(e, p)
	}
	if e.Action == "status" {
		r, err := loadRecord(str(e.Params, "operationId"))
		if err != nil {
			return nil, err
		}
		if r.ActorID != e.ActorID {
			return nil, errors.New("operation belongs to another actor")
		}
		if r.Action == "copy" || r.Action == "publish" {
			if lease, leaseErr := readCopyLease(r.ID); leaseErr == nil && lease.State == "expired" && r.State != "completed" {
				return map[string]any{"state": "outcome_unknown", "operationId": r.ID, "message": "Copy lease expired; no uncertain mutation is replayed."}, nil
			}
		}
		return map[string]any{"state": r.State, "result": r.Result, "operationId": r.ID}, nil
	}
	if e.Action == "renew" {
		guard, lockErr := namedLock(str(e.Params, "sessionId"))
		if lockErr != nil {
			return nil, lockErr
		}
		defer guard.Close()
		r, err := loadRecord(str(e.Params, "sessionId"))
		if err != nil {
			return nil, err
		}
		if r.ActorID != e.ActorID || r.State != "active" || r.PolicyHash != e.PolicyHash || r.Deadline < time.Now().UnixMilli() || r.LeaseUntil < time.Now().UnixMilli() {
			return nil, errors.New("terminal lease expired")
		}
		r.LeaseUntil = min(r.Deadline, time.Now().Add(time.Duration(r.LeaseSeconds)*time.Second).UnixMilli())
		return map[string]any{"ok": true}, atomicJSON(recordPath(r.ID), r)
	}
	if e.Action == "metrics" {
		return metrics(p)
	}
	if e.Action == "services" {
		items := []map[string]any{}
		for _, id := range actor.Services {
			service, ok := p.Services[id]
			if !ok {
				continue
			}
			state, statusErr := serviceCommand(service, false)
			if service.PM2Name != "" {
				if statusErr == nil && regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(strings.TrimSpace(state)) {
					state = "online"
				} else {
					state = "offline"
				}
			}
			if statusErr != nil && state == "" {
				state = "unavailable"
			}
			items = append(items, map[string]any{"id": id, "name": service.Name, "state": strings.TrimSpace(state), "restartable": service.Restartable})
		}
		return map[string]any{"services": items}, nil
	}
	if e.Action == "logs" || e.Action == "restart" {
		id := str(e.Params, "serviceId")
		allowed := false
		for _, v := range actor.Services {
			if v == id {
				allowed = true
			}
		}
		service, ok := p.Services[id]
		if !allowed || !ok {
			return nil, errors.New("service not approved")
		}
		if e.Action == "logs" {
			lines := integer(e.Params, "lines")
			if lines < 1 || lines > 2000 {
				lines = 200
			}
			var out string
			var err error
			if service.PM2Name != "" {
				out, err = boundedCommand("/usr/bin/pm2", "logs", service.PM2Name, "--nostream", "--lines", strconv.Itoa(lines))
			} else {
				out, err = boundedCommand("/bin/journalctl", "--no-pager", "--output=short-iso", "--unit="+service.Unit, "--lines="+strconv.Itoa(lines))
			}
			return map[string]any{"output": out}, err
		}
		if !service.Restartable {
			return nil, errors.New("service restart disabled")
		}
		return startServiceOperation(e, p, id)
	}
	return fileOperation(e, p, actor)
}
func serviceCommand(s Service, restart bool) (string, error) {
	if s.HealthKind == "broker" {
		const file = "/run/omnilodge-system/broker-unit"
		if err := protectedFile(file); err != nil {
			return "", err
		}
		b, err := os.ReadFile(file)
		if err != nil {
			return "", err
		}
		unit := strings.TrimSpace(string(b))
		if !regexp.MustCompile(`^omnilodge-system-[0-9]+-[a-f0-9]{8}\.service$`).MatchString(unit) {
			return "", errors.New("broker identity unavailable")
		}
		action := "is-active"
		if restart {
			action = "stop"
		}
		return boundedCommand("/bin/systemctl", action, unit)
	}

	if s.PM2Name != "" {
		if !identifier.MatchString(s.PM2Name) {
			return "", errors.New("invalid PM2 service name")
		}
		if restart {
			return boundedCommand("/usr/bin/pm2", "restart", s.PM2Name, "--update-env")
		}
		return boundedCommand("/usr/bin/pm2", "pid", s.PM2Name)
	}
	if !regexp.MustCompile(`^[a-zA-Z0-9_.@-]+\.service$`).MatchString(s.Unit) {
		return "", errors.New("invalid service unit")
	}
	action := "is-active"
	if restart {
		action = "restart"
	}
	return boundedCommand("/bin/systemctl", action, s.Unit)
}
func createRecord(record Record) error {
	guard, err := namedLock("journal-admission")
	if err != nil {
		return err
	}
	defer guard.Close()
	if _, err := os.Stat(recordPath(record.ID)); os.IsNotExist(err) {
		entries, readErr := boundedEntries(filepath.Join(statePath, "operations"))
		if readErr != nil {
			return readErr
		}
		if len(entries) >= 10000 {
			return errors.New("root operation journal capacity reached; reconcile retained outcomes")
		}
	}
	return atomicJSON(recordPath(record.ID), record)
}
func journaled(e Envelope, id string, fn func() (map[string]any, error)) (map[string]any, error) {
	if !uuid.MatchString(id) {
		return nil, errors.New("invalid operation identity")
	}
	opLock, lockErr := namedLock(id)
	if lockErr != nil {
		return nil, lockErr
	}
	defer opLock.Close()
	encoded, _ := json.Marshal(e.Params)
	digest := sha256.Sum256(append([]byte(e.Action+":"), encoded...))
	payloadHash := hex.EncodeToString(digest[:])
	if old, err := loadRecord(id); err == nil {
		if old.ActorID != e.ActorID || old.Action != e.Action || old.PayloadHash != payloadHash || old.Fence != integer(e.Params, "fence") {
			return nil, errors.New("operation identity mismatch")
		}
		if old.State == "completed" {
			return old.Result, nil
		}
		if !(old.State == "queued" && len(os.Args) == 3 && os.Args[1] == "copy-operation" && os.Args[2] == id) {
			return nil, errors.New("prior operation outcome requires reconciliation")
		}
	}
	r := Record{ID: id, ActorID: e.ActorID, Action: e.Action, PayloadHash: payloadHash, Fence: integer(e.Params, "fence"), State: "running", ExpiresAt: int64(integer(e.Params, "metadataExpiresAt"))}
	if err := createRecord(r); err != nil {
		return nil, err
	}
	result, err := fn()
	if err != nil {
		r.State = "outcome_unknown"
		_ = atomicJSON(recordPath(id), r)
		return nil, err
	}
	r.State = "completed"
	r.Result = result
	return result, atomicJSON(recordPath(id), r)
}
func run() error {
	if os.Geteuid() != 0 {
		return errors.New("adapter requires its fixed privileged gateway")
	}
	p, err := loadPolicy()
	if err != nil {
		return err
	}
	if len(os.Args) == 3 && os.Args[1] == "root-sftp" {
		return rootSFTP(os.Args[2], p)
	}
	if len(os.Args) == 3 && os.Args[1] == "copy-operation" {
		return completeCopy(os.Args[2], p)
	}
	if len(os.Args) == 3 && os.Args[1] == "service-operation" {
		return completeServiceOperation(os.Args[2], p)
	}
	if len(os.Args) == 2 && os.Args[1] == "cleanup" {
		return cleanup(p)
	}
	if len(os.Args) == 2 && os.Args[1] == "watchdog" {
		return watchdog()
	}
	if len(os.Args) != 1 {
		return errors.New("unexpected adapter arguments")
	}
	reader := bufio.NewReader(io.LimitReader(os.Stdin, 1<<20))
	line, err := reader.ReadString('\n')
	if err != nil {
		return errors.New("authorization envelope required")
	}
	if len(line) > 131072 {
		return errors.New("authorization too large")
	}
	line = strings.TrimSpace(line)
	lock, err := globalLock()
	if err != nil {
		return err
	}
	defer lock.Close()
	if strings.HasPrefix(line, "{") {
		err := stopCapability(line)
		if err == nil {
			output(map[string]any{"ok": true})
		}
		return err
	}
	e, err := verify(line, p, time.Now())
	if err != nil {
		return err
	}
	if err = consume(e.Nonce); err != nil {
		return err
	}
	p, err = applyRuntimeBudget(e, p)
	if err != nil {
		return err
	}
	if _, err = managedResourceLimits(p); err != nil {
		return err
	}
	if e.Action == "terminal" {
		return terminal(e, p, io.MultiReader(reader, os.Stdin), func() { _ = lock.Close() })
	}
	_ = lock.Close()
	result, err := dispatch(e, p)
	if err != nil {
		return err
	}
	output(result)
	return nil
}
func main() {
	if err := run(); err != nil {
		fail(err)
	}
}
