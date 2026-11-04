//go:build windows

package main

import "errors"

func rootSFTP(string, Policy) error { return errors.New("root SFTP requires Linux") }
