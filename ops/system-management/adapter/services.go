package main

import (
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// Service work outlives the initiating SSH channel, including a backend restart
// that stops its own broker. The root journal is the source of the outcome.
func startServiceOperation(e Envelope, p Policy, serviceID string) (map[string]any, error) {
	id := str(e.Params, "operationId")
	if !uuid.MatchString(id) {
		return nil, errors.New("invalid service operation identity")
	}
	guard, err := namedLock(id)
	if err != nil {
		return nil, err
	}
	defer guard.Close()
	encoded, _ := json.Marshal(e.Params)
	digest := sha256.Sum256(append([]byte("restart:"), encoded...))
	hash := hex.EncodeToString(digest[:])
	if old, err := loadRecord(id); err == nil {
		if old.ActorID != e.ActorID || old.Action != "restart" || old.PayloadHash != hash || old.Fence != integer(e.Params, "fence") {
			return nil, errors.New("service operation identity mismatch")
		}
		return map[string]any{"accepted": true, "state": old.State, "operationId": id, "verifiedHealthy": old.State == "completed"}, nil
	}
	record := Record{ID: id, ActorID: e.ActorID, Action: "restart", ServiceID: serviceID, PayloadHash: hash, Fence: integer(e.Params, "fence"), State: "running"}
	if err = atomicJSON(recordPath(id), record); err != nil {
		return nil, err
	}
	_, err = boundedCommand("/usr/bin/systemd-run", "--quiet", "--no-block", "--collect", "--unit=omnilodge-operation-"+id, "--property=Type=exec", "--property=RuntimeMaxSec=120s", "--property=MemoryMax=67108864", "--property=CPUQuota=25%", "--property=TasksMax=32", "--property=NoNewPrivileges=yes", "--property=PrivateTmp=yes", "--", "/usr/local/libexec/omnilodge/system-adapter", "service-operation", id)
	if err != nil {
		record.State = "outcome_unknown"
		_ = atomicJSON(recordPath(id), record)
		return nil, err
	}
	return map[string]any{"accepted": true, "operationId": id, "state": "running", "verifiedHealthy": false}, nil
}
func completeServiceOperation(id string, p Policy) error {
	if !uuid.MatchString(id) {
		return errors.New("invalid operation identity")
	}
	guard, err := namedLock(id)
	if err != nil {
		return err
	}
	defer guard.Close()
	record, err := loadRecord(id)
	if err != nil {
		return err
	}
	if record.Action != "restart" || record.State != "running" {
		return errors.New("service operation is not running")
	}
	service, ok := p.Services[record.ServiceID]
	if !ok || !service.Restartable {
		return errors.New("service no longer approved")
	}
	before, _ := serviceCommand(service, false)
	_, restartErr := serviceCommand(service, true)
	if restartErr != nil {
		record.State = "outcome_unknown"
		record.Result = map[string]any{"verifiedHealthy": false, "message": "Restart command was not confirmed; inspect service state."}
		_ = atomicJSON(recordPath(id), record)
		return restartErr
	}
	deadline := time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		state, stateErr := serviceCommand(service, false)
		healthy, release := serviceHealth(service)
		if stateErr == nil && healthy {
			record.State = "completed"
			record.Result = map[string]any{"verifiedHealthy": true, "observedState": strings.TrimSpace(state), "previousState": strings.TrimSpace(before), "release": release}
			return atomicJSON(recordPath(id), record)
		}
		time.Sleep(time.Second)
	}
	record.State = "failed"
	record.Result = map[string]any{"verifiedHealthy": false, "message": "Restart was submitted, but readiness did not recover within 90 seconds."}
	return atomicJSON(recordPath(id), record)
}
func serviceHealth(service Service) (bool, string) {
	target := ""
	transport := &http.Transport{}
	switch service.HealthKind {
	case "backend":
		target = "http://127.0.0.1:3001/api/health/ready"
	case "ui":
		target = "https://127.0.0.1/healthz"
		certificate, err := os.ReadFile("/etc/omnilodge/tls/origin.pem")
		if err != nil {
			return false, ""
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(certificate) {
			return false, ""
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: roots, ServerName: "omni-lodge.com", MinVersion: tls.VersionTLS12}
	default:
		return false, ""
	}
	client := &http.Client{Transport: transport, Timeout: 2 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("health redirect rejected") }}
	defer transport.CloseIdleConnections()
	request, _ := http.NewRequest(http.MethodGet, target, nil)
	request.Host = "omni-lodge.com"
	response, err := client.Do(request)
	if err != nil {
		return false, ""
	}
	defer response.Body.Close()
	var result struct {
		Status  string `json:"status"`
		Release string `json:"release"`
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 16384)).Decode(&result)
	return err == nil && response.StatusCode == 200 && result.Status == "ok" && result.Release != "", result.Release
}
