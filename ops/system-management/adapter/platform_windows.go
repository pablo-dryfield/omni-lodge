//go:build windows

package main

import (
	"errors"
	"os"
)

func protectedFile(string) error              { return errors.New("managed adapter requires Linux") }
func namedLock(string) (*os.File, error)      { return nil, errors.New("managed adapter requires Linux") }
func globalLock() (*os.File, error)           { return nil, errors.New("managed adapter requires Linux") }
func hardlinks(os.FileInfo) uint64            { return 1 }
func uid(os.FileInfo) uint32                  { return 0 }
func gid(os.FileInfo) uint32                  { return 0 }
func modeBits(info os.FileInfo) uint32        { return uint32(info.Mode()) }
func diskInfo(string) (map[string]any, error) { return nil, errors.New("Linux capability unavailable") }
func metrics(Policy) (map[string]any, error)  { return nil, errors.New("Linux capability unavailable") }
