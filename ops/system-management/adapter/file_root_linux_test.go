//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivilegedPathsArePinnedWithoutFollowingSymlinks(t *testing.T) {
	allowed, outside := t.TempDir(), t.TempDir()
	source := filepath.Join(allowed, "source.txt")
	target := filepath.Join(outside, "target.txt")
	if err := os.WriteFile(source, []byte("source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("outside fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(allowed, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(allowed, "leaf-link")); err != nil {
		t.Fatal(err)
	}
	base, err := os.OpenRoot("/")
	if err != nil {
		t.Fatal(err)
	}
	root := privilegedFileRoot(base)
	defer root.Close()
	relative := func(name string) string { return strings.TrimPrefix(name, "/") }
	if _, err = root.Open(relative(filepath.Join(allowed, "link", "target.txt"))); err == nil {
		t.Fatal("read followed a parent symlink")
	}
	if _, err = root.Open(relative(filepath.Join(allowed, "leaf-link"))); err == nil {
		t.Fatal("read followed a leaf symlink")
	}
	if _, err = root.OpenFile(relative(filepath.Join(allowed, "link", "target.txt")), os.O_WRONLY|os.O_TRUNC, 0600); err == nil {
		t.Fatal("write followed a symlink")
	}
	if err = root.MkdirAll(relative(filepath.Join(allowed, "link", "new-folder")), 0700); err == nil {
		t.Fatal("directory creation followed a symlink")
	}
	if err = root.Rename(relative(source), relative(filepath.Join(allowed, "link", "moved.txt"))); err == nil {
		t.Fatal("rename followed a destination symlink")
	}
	if err = root.Rename(relative(source), relative(filepath.Join(allowed, "moved.txt"))); err != nil {
		t.Fatal(err)
	}
	bytes, err := os.ReadFile(target)
	if err != nil || string(bytes) != "outside fixture" {
		t.Fatal("outside fixture changed")
	}
}
