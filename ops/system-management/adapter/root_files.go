package main

import (
	"errors"
	"os"
	"path"
	"strings"
)

func privateCopyDirectory(root *os.Root, name string) error {
	if err := noLinks(root, name, false); err != nil {
		return err
	}
	info, err := root.Lstat(name)
	if err != nil || !info.IsDir() || uid(info) != 0 || info.Mode().Perm()&0077 != 0 {
		return errors.New("private copy directory must be root-owned and private")
	}
	return nil
}

func rootMutationPath(policy RootPolicy, name string) error {
	if !policy.Privileged {
		return nil
	}
	if policy.Path != "/" {
		return errors.New("invalid privileged file root")
	}
	resolved := path.Clean(path.Join("/", name))
	for _, protected := range []string{"/opt/omnilodge", "/usr/local/libexec/omnilodge", "/var/lib/omnilodge/deploy"} {
		if resolved == "/" || resolved == protected || strings.HasPrefix(resolved, protected+"/") || strings.HasPrefix(protected, resolved+"/") {
			return errors.New("deployment-controlled files are read-only; use the release workflow")
		}
	}
	return nil
}
func rootCapability(e Envelope, actor Actor) error {
	if root, ok := actor.Roots[str(e.Params, "rootId")]; ok && root.Privileged && !boolean(e.Params, "privilegedRoot") {
		return errors.New("root file capability is not authorized by the current server profile")
	}
	return nil
}
