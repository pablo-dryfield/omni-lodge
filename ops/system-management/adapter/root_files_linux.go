//go:build linux

package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"regexp"
)

const rootFileStaging = "/.omnilodge-root-staging"

func rootSFTP(actorID string, p Policy) error {
	if !regexp.MustCompile(`^[1-9][0-9]*$`).MatchString(actorID) {
		return errors.New("invalid root file actor")
	}
	actor, ok := p.Actors[actorID]
	root, enrolled := actor.Roots["server"]
	if !ok || !enrolled || !root.Privileged || root.Path != "/" || root.Staging != "/srv/omnilodge-root-staging/u"+actorID {
		return errors.New("root file gateway is not enrolled")
	}
	info, err := os.Lstat(root.Staging)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || uid(info) != 0 || info.Mode().Perm()&0077 != 0 {
		return errors.New("root file staging must be private and root-owned")
	}
	if _, err = os.Stat("/usr/lib/openssh/sftp-server"); err != nil {
		return errors.New("root SFTP server is unavailable")
	}
	var random [12]byte
	if _, err = rand.Read(random[:]); err != nil {
		return err
	}
	cmd := exec.Command("/usr/bin/systemd-run", "--quiet", "--wait", "--pipe", "--collect",
		"--unit=omnilodge-root-files-"+actorID+"-"+hex.EncodeToString(random[:]),
		"--uid=root", "--gid=root", "--slice=omnilodge-console.slice", "--property=Type=exec",
		"--property=MemoryMax=134217728", "--property=CPUQuota=25%", "--property=TasksMax=64",
		"--property=RuntimeMaxSec=7200s", "--property=KillMode=control-group", "--property=NoNewPrivileges=yes",
		"--property=ProtectSystem=strict", "--property=ProtectHome=read-only", "--property=ProtectKernelTunables=yes",
		"--property=InaccessiblePaths=/proc /sys", "--property=PrivateDevices=yes",
		"--property=CapabilityBoundingSet=CAP_DAC_READ_SEARCH",
		"--property=ProtectControlGroups=yes", "--property=BindPaths="+root.Staging+":"+rootFileStaging,
		"--property=ReadWritePaths="+rootFileStaging,
		"--", "/usr/lib/openssh/sftp-server", "-d", "/", "-u", "0077")
	cmd.Env = []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "LANG=C.UTF-8"}
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	return cmd.Run()
}
