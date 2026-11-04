//go:build linux

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func protectedFile(name string) error {
	info, err := os.Lstat(name)
	if err != nil {
		return err
	}
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok || s.Uid != 0 || info.Mode().Perm()&0022 != 0 || !info.Mode().IsRegular() {
		return errors.New("host policy must be a root-owned regular file without group/world writes")
	}
	return nil
}
func namedLock(name string) (*os.File, error) {
	if !identifier.MatchString(name) && !uuid.MatchString(name) {
		return nil, errors.New("invalid lock identity")
	}
	f, err := os.OpenFile(filepath.Join(statePath, "locks", name), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
func globalLock() (*os.File, error)     { return namedLock("authority") }
func hardlinks(info os.FileInfo) uint64 { return uint64(info.Sys().(*syscall.Stat_t).Nlink) }
func uid(info os.FileInfo) uint32       { return info.Sys().(*syscall.Stat_t).Uid }
func gid(info os.FileInfo) uint32       { return info.Sys().(*syscall.Stat_t).Gid }
func modeBits(info os.FileInfo) uint32  { return info.Sys().(*syscall.Stat_t).Mode }
func diskInfo(name string) (map[string]any, error) {
	var s syscall.Statfs_t
	if err := syscall.Statfs(name, &s); err != nil {
		return nil, err
	}
	return map[string]any{"freeBytes": s.Bavail * uint64(s.Bsize), "totalBytes": s.Blocks * uint64(s.Bsize), "freeInodes": s.Ffree}, nil
}
func metrics(p Policy) (map[string]any, error) {
	limits, err := managedResourceLimits(p)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"sampledAt": time.Now().UTC().Format(time.RFC3339), "cpuPercent": nil, "resources": limits}
	total, idle, readErr := cpuSample()
	if readErr == nil {
		time.Sleep(200 * time.Millisecond)
		nextTotal, nextIdle, nextErr := cpuSample()
		if nextErr == nil && nextTotal > total {
			result["cpuPercent"] = 100 * (1 - float64(nextIdle-idle)/float64(nextTotal-total))
		}
	}
	if b, err := os.ReadFile("/proc/uptime"); err == nil {
		fields := strings.Fields(string(b))
		if len(fields) > 0 {
			result["uptimeSeconds"], _ = strconv.ParseFloat(fields[0], 64)
		}
	}
	if b, err := os.ReadFile("/proc/meminfo"); err == nil {
		values := map[string]uint64{}
		for _, line := range strings.Split(string(b), "\n") {
			f := strings.Fields(line)
			if len(f) > 1 {
				n, _ := strconv.ParseUint(f[1], 10, 64)
				values[strings.TrimSuffix(f[0], ":")] = n * 1024
			}
		}
		result["memoryUsedBytes"] = values["MemTotal"] - values["MemAvailable"]
		result["memoryTotalBytes"] = values["MemTotal"]
	}
	if disk, err := diskInfo("/"); err == nil {
		result["diskFreeBytes"] = disk["freeBytes"]
		result["freeInodes"] = disk["freeInodes"]
	}
	if release, err := os.Readlink("/opt/omnilodge/backend-current"); err == nil {
		result["release"] = filepath.Base(filepath.Dir(release))
	}
	if boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id"); err == nil {
		result["bootId"] = strings.TrimSpace(string(boot))
	}
	return result, nil
}

func cpuSample() (uint64, uint64, error) {
	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	line := strings.SplitN(string(b), "\n", 2)[0]
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, errors.New("CPU counters unavailable")
	}
	var total, idle uint64
	for i, field := range fields[1:] {
		if i >= 8 {
			break
		}
		value, err := strconv.ParseUint(field, 10, 64)
		if err != nil {
			return 0, 0, err
		}
		total += value
		if i == 3 || i == 4 {
			idle += value
		}
	}
	return total, idle, nil
}
