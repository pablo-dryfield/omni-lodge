//go:build windows

package main

import "os"

// Privileged runtime enrollment and its gateway are Linux-only.
func privilegedFileRoot(root *os.Root) fileRoot { return root }
