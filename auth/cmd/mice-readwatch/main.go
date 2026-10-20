// boxen-readwatch: recursively watch a directory for file open/access events
// and print absolute paths (one per line) to stdout. Used by the jobs runner
// when inotify-tools is unavailable (e.g. Alpine + corp TLS).
package main

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: boxen-readwatch <dir>")
		os.Exit(2)
	}
	root, err := filepath.Abs(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		fmt.Fprintln(os.Stderr, "not a directory:", root)
		os.Exit(1)
	}

	fd, err := unix.InotifyInit1(unix.IN_CLOEXEC)
	if err != nil {
		fmt.Fprintln(os.Stderr, "inotify_init:", err)
		os.Exit(1)
	}
	defer unix.Close(fd)

	wdPath := map[uint32]string{}
	var addWatch func(string)
	addWatch = func(dir string) {
		wd, err := unix.InotifyAddWatch(
			fd,
			dir,
			unix.IN_OPEN|unix.IN_ACCESS|unix.IN_CREATE|unix.IN_MOVED_TO,
		)
		if err != nil {
			fmt.Fprintln(os.Stderr, "inotify_add_watch:", dir, err)
			return
		}
		wdPath[uint32(wd)] = dir
		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}
		for _, e := range entries {
			if e.IsDir() {
				addWatch(filepath.Join(dir, e.Name()))
			}
		}
	}
	addWatch(root)

	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigc
		os.Exit(0)
	}()

	seen := map[string]bool{}
	buf := make([]byte, 64*1024)
	for {
		n, err := unix.Read(fd, buf)
		if err != nil {
			if err == unix.EINTR {
				continue
			}
			fmt.Fprintln(os.Stderr, "inotify read:", err)
			os.Exit(1)
		}
		offset := 0
		for offset+unix.SizeofInotifyEvent <= n {
			raw := buf[offset:]
			ev := (*unix.InotifyEvent)(unsafe.Pointer(&raw[0]))
			name := ""
			if ev.Len > 0 {
				nameBytes := raw[unix.SizeofInotifyEvent : unix.SizeofInotifyEvent+int(ev.Len)]
				name = strings.TrimRight(string(nameBytes), "\x00")
			}
			dir := wdPath[uint32(ev.Wd)]
			full := dir
			if name != "" {
				full = filepath.Join(dir, name)
			}
			if ev.Mask&unix.IN_ISDIR != 0 &&
				ev.Mask&(unix.IN_CREATE|unix.IN_MOVED_TO) != 0 {
				addWatch(full)
			}
			if ev.Mask&(unix.IN_OPEN|unix.IN_ACCESS) != 0 &&
				ev.Mask&unix.IN_ISDIR == 0 {
				fi, err := os.Stat(full)
				if err == nil && !fi.IsDir() && !seen[full] {
					seen[full] = true
					fmt.Println(full)
				}
			}
			offset += unix.SizeofInotifyEvent + int(ev.Len)
		}
	}
}
