//go:build linux

package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type RuntimeBudget struct {
	MemoryMiB  int `json:"memoryMiB"`
	CPUPercent int `json:"cpuPercent"`
	Tasks      int `json:"tasks"`
}

func applyRuntimeBudget(e Envelope, p Policy) (Policy, error) {
	var storage struct {
		ReserveBytes   int64 `json:"reserveBytes"`
		ReservePercent int   `json:"reservePercent"`
	}
	if json.Unmarshal(e.Params["storagePolicy"], &storage) != nil || storage.ReserveBytes < 1<<30 || storage.ReservePercent < 15 || storage.ReservePercent > 50 {
		return p, errors.New("invalid destination reserve policy")
	}
	p.ReserveBytes = max(p.ReserveBytes, storage.ReserveBytes)
	p.ReservePercent = max(p.ReservePercent, storage.ReservePercent)
	var budget RuntimeBudget
	if json.Unmarshal(e.Params["runtimeBudget"], &budget) != nil || budget.MemoryMiB < 64 || budget.MemoryMiB > p.MemoryMiB || budget.CPUPercent < 1 || budget.CPUPercent > p.CPUPercent || budget.Tasks < 16 || budget.Tasks > p.Tasks {
		return p, errors.New("runtime budget exceeds the root-owned host ceiling")
	}
	lease := integer(e.Params, "remoteLeaseSeconds")
	if lease < 30 || lease > 60 {
		return p, errors.New("invalid remote authorization lease")
	}
	var deadline int64
	if json.Unmarshal(e.Params["authorizationExpiresAt"], &deadline) != nil || deadline <= time.Now().UnixMilli() || deadline > time.Now().Add(2*time.Hour+time.Minute).UnixMilli() {
		return p, errors.New("invalid execution authorization deadline")
	}
	file := filepath.Join(statePath, "runtime-budget.json")
	var previous struct {
		Budget RuntimeBudget `json:"budget"`
		BootID string        `json:"bootId"`
	}
	b, err := os.ReadFile(file)
	if err == nil {
		_ = json.Unmarshal(b, &previous)
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return p, err
	}
	bootID := strings.TrimSpace(string(boot))
	if previous.Budget != budget || previous.BootID != bootID {
		if _, err = boundedCommand("/bin/systemctl", "set-property", "--runtime", "omnilodge-console.slice", "MemoryMax="+strconv.Itoa(budget.MemoryMiB*1048576), "CPUQuota="+strconv.Itoa(budget.CPUPercent)+"%", "TasksMax="+strconv.Itoa(budget.Tasks)); err != nil {
			return p, err
		}
		if err = atomicJSON(file, map[string]any{"budget": budget, "bootId": bootID}); err != nil {
			return p, err
		}
	}
	p.MemoryMiB = budget.MemoryMiB
	p.CPUPercent = budget.CPUPercent
	p.Tasks = budget.Tasks
	p.LeaseSeconds = lease
	p.RuntimeExpires = deadline
	return p, nil
}

type observedLimits struct {
	memory uint64
	cpu    float64
	tasks  uint64
}

func resourceNumber(file string) (uint64, error) {
	b, err := os.ReadFile(file)
	if err != nil {
		return 0, err
	}
	value, err := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
	if err != nil || value == 0 {
		return 0, errors.New("resource controller is missing or unbounded")
	}
	return value, nil
}
func currentLimits() (observedLimits, error) {
	var result observedLimits
	b, err := os.ReadFile("/proc/self/cgroup")
	if err != nil {
		return result, err
	}
	rows := strings.Split(strings.TrimSpace(string(b)), "\n")
	locations := map[string]string{}
	boundedScope := false
	for _, line := range rows {
		parts := strings.SplitN(line, ":", 3)
		if len(parts) != 3 || !strings.HasPrefix(parts[2], "/") || strings.Contains(parts[2], "..") {
			return result, errors.New("invalid cgroup identity")
		}
		if strings.Contains(parts[2], "/omnilodge-console.slice/") {
			boundedScope = true
		}
		if parts[0] == "0" && parts[1] == "" {
			locations["unified"] = "/sys/fs/cgroup" + parts[2]
		}
		for _, controller := range strings.Split(parts[1], ",") {
			prefix := controller
			if controller == "cpu" {
				prefix = "cpu,cpuacct"
			}
			locations[controller] = "/sys/fs/cgroup/" + prefix + parts[2]
		}
	}
	if !boundedScope {
		return result, errors.New("execution is outside the console resource slice")
	}
	if _, legacy := locations["memory"]; !legacy {
		root := locations["unified"]
		if root == "" {
			return result, errors.New("cgroup memory controller unavailable")
		}
		result.memory, err = resourceNumber(root + "/memory.max")
		if err != nil {
			return result, err
		}
		result.tasks, err = resourceNumber(root + "/pids.max")
		if err != nil {
			return result, err
		}
		cpu, err := os.ReadFile(root + "/cpu.max")
		if err != nil {
			return result, err
		}
		fields := strings.Fields(string(cpu))
		if len(fields) != 2 {
			return result, errors.New("CPU controller unavailable")
		}
		quota, e1 := strconv.ParseFloat(fields[0], 64)
		period, e2 := strconv.ParseFloat(fields[1], 64)
		if e1 != nil || e2 != nil || quota <= 0 || period <= 0 {
			return result, errors.New("CPU controller unbounded")
		}
		result.cpu = quota / period * 100
		return result, nil
	}
	for _, controller := range []string{"memory", "pids", "cpu"} {
		if locations[controller] == "" {
			return result, errors.New("legacy controller unavailable")
		}
	}
	result.memory, err = resourceNumber(locations["memory"] + "/memory.limit_in_bytes")
	if err != nil {
		return result, err
	}
	result.tasks, err = resourceNumber(locations["pids"] + "/pids.max")
	if err != nil {
		return result, err
	}
	quota, err := resourceNumber(locations["cpu"] + "/cpu.cfs_quota_us")
	if err != nil {
		return result, err
	}
	period, err := resourceNumber(locations["cpu"] + "/cpu.cfs_period_us")
	if err != nil {
		return result, err
	}
	result.cpu = float64(quota) / float64(period) * 100
	return result, nil
}
func managedResourceLimits(p Policy) (map[string]any, error) {
	own, err := currentLimits()
	if err != nil {
		return nil, err
	}
	text, err := boundedCommand("/bin/systemctl", "show", "omnilodge-console.slice", "--property=MemoryMax,CPUQuotaPerSecUSec,TasksMax")
	if err != nil {
		return nil, err
	}
	values := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			values[parts[0]] = parts[1]
		}
	}
	memory, e1 := strconv.ParseUint(values["MemoryMax"], 10, 64)
	tasks, e2 := strconv.ParseUint(values["TasksMax"], 10, 64)
	quota, e3 := time.ParseDuration(values["CPUQuotaPerSecUSec"])
	cpu := quota.Seconds() * 100
	if e1 != nil || e2 != nil || e3 != nil || memory == 0 || tasks == 0 || cpu <= 0 || memory > uint64(p.MemoryMiB)*1048576 || tasks > uint64(p.Tasks) || cpu > float64(p.CPUPercent) {
		return nil, errors.New("aggregate console limits are not enforced")
	}
	memory = min(memory, own.memory)
	tasks = min(tasks, own.tasks)
	cpu = min(cpu, own.cpu)
	if memory > uint64(p.MemoryMiB)*1048576 || tasks > uint64(p.Tasks) || cpu > float64(p.CPUPercent) {
		return nil, errors.New("console execution is not resource bounded")
	}
	return map[string]any{"enforced": true, "memoryBytes": memory, "cpuPercent": cpu, "tasks": tasks, "aggregateMemoryBytes": uint64(p.MemoryMiB) * 1048576, "aggregateTasks": p.Tasks, "aggregateCpuPercent": p.CPUPercent}, nil
}
