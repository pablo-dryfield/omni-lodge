//go:build linux

package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// os.Root confines ordinary workspaces. For the privileged / namespace, pin
// every parent directory with openat(O_NOFOLLOW) and operate on its descriptor.
// A concurrent symlink replacement must never redirect a reviewed root action.
type privilegedRoot struct{ *os.Root }

func privilegedFileRoot(root *os.Root) fileRoot { return &privilegedRoot{root} }

type pinnedParent struct {
	root *os.Root
	fd   int
	leaf string
}

func (p pinnedParent) close() { p.root.Close(); syscall.Close(p.fd) }
func rootParts(name string) ([]string, error) {
	if filepath.IsAbs(name) || strings.ContainsAny(name, "\x00\\") {
		return nil, errors.New("invalid root file path")
	}
	for _, part := range strings.Split(name, "/") {
		if part == ".." {
			return nil, errors.New("parent traversal denied")
		}
	}
	return strings.Split(filepath.Clean(name), "/"), nil
}
func walkRoot(parts []string, create bool, mode os.FileMode) (int, error) {
	fd, err := syscall.Open("/", syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_CLOEXEC, 0)
	if err != nil {
		return -1, err
	}
	for _, part := range parts {
		if part == "." || part == "" {
			continue
		}
		if create {
			err = syscall.Mkdirat(fd, part, uint32(mode.Perm()))
			if err != nil && !errors.Is(err, syscall.EEXIST) {
				syscall.Close(fd)
				return -1, err
			}
		}
		next, openErr := syscall.Openat(fd, part, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		syscall.Close(fd)
		if openErr != nil {
			return -1, openErr
		}
		fd = next
	}
	return fd, nil
}
func pinParent(name string) (pinnedParent, error) {
	parts, err := rootParts(name)
	if err != nil {
		return pinnedParent{}, err
	}
	fd, err := walkRoot(parts[:len(parts)-1], false, 0)
	if err != nil {
		return pinnedParent{}, err
	}
	root, err := os.OpenRoot("/proc/self/fd/" + strconv.Itoa(fd))
	if err != nil {
		syscall.Close(fd)
		return pinnedParent{}, err
	}
	return pinnedParent{root, fd, parts[len(parts)-1]}, nil
}
func (r *privilegedRoot) Lstat(name string) (os.FileInfo, error) {
	p, err := pinParent(name)
	if err != nil {
		return nil, err
	}
	defer p.close()
	return p.root.Lstat(p.leaf)
}
func (r *privilegedRoot) Open(name string) (*os.File, error) { return r.OpenFile(name, os.O_RDONLY, 0) }
func (r *privilegedRoot) OpenFile(name string, flags int, mode os.FileMode) (*os.File, error) {
	p, err := pinParent(name)
	if err != nil {
		return nil, err
	}
	defer p.close()
	fd, err := syscall.Openat(p.fd, p.leaf, flags|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, uint32(mode.Perm()))
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), name)
	info, err := f.Stat()
	if err != nil || (!info.Mode().IsRegular() && !info.IsDir()) {
		f.Close()
		return nil, errors.New("special-file access denied")
	}
	return f, nil
}
func (r *privilegedRoot) Mkdir(name string, mode os.FileMode) error {
	p, err := pinParent(name)
	if err != nil {
		return err
	}
	defer p.close()
	return syscall.Mkdirat(p.fd, p.leaf, uint32(mode.Perm()))
}
func (r *privilegedRoot) MkdirAll(name string, mode os.FileMode) error {
	parts, err := rootParts(name)
	if err != nil {
		return err
	}
	fd, err := walkRoot(parts, true, mode)
	if err != nil {
		return err
	}
	return syscall.Close(fd)
}
func (r *privilegedRoot) ReadFile(name string) ([]byte, error) {
	f, err := r.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}
func (r *privilegedRoot) WriteFile(name string, b []byte, mode os.FileMode) error {
	f, err := r.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func (r *privilegedRoot) Remove(name string) error {
	p, err := pinParent(name)
	if err != nil {
		return err
	}
	defer p.close()
	return p.root.Remove(p.leaf)
}
func (r *privilegedRoot) RemoveAll(name string) error {
	p, err := pinParent(name)
	if err != nil {
		return err
	}
	defer p.close()
	return p.root.RemoveAll(p.leaf)
}
func (r *privilegedRoot) Rename(from, to string) error {
	a, err := pinParent(from)
	if err != nil {
		return err
	}
	defer a.close()
	b, err := pinParent(to)
	if err != nil {
		return err
	}
	defer b.close()
	return syscall.Renameat(a.fd, a.leaf, b.fd, b.leaf)
}
