// mice-xattr prints user.overlay.* extended attributes of a tree in
// `getfattr -R -h -e hex --absolute-names` format, for images without the attr package.
// Usage: mice-xattr <dir>
package main

import (
	"bufio"
	"fmt"
	"golang.org/x/sys/unix"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func escape(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		c := p[i]
		if c <= 0x20 || c >= 0x7f || c == '"' || c == '\\' {
			fmt.Fprintf(&b, "\\%03o", c)
		} else {
			b.WriteByte(c)
		}
	}
	return b.String()
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: mice-xattr <dir>")
		os.Exit(2)
	}
	out := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer out.Flush()
	root := filepath.Clean(os.Args[1])
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		size, err := unix.Llistxattr(path, nil)
		if err != nil || size <= 0 {
			return nil
		}
		buf := make([]byte, size)
		size, err = unix.Llistxattr(path, buf)
		if err != nil {
			return nil
		}
		wrote := false
		for _, name := range strings.Split(string(buf[:size]), "\x00") {
			if !strings.HasPrefix(name, "user.overlay.") {
				continue
			}
			vsz, err := unix.Lgetxattr(path, name, nil)
			if err != nil {
				continue
			}
			val := make([]byte, vsz)
			if vsz > 0 {
				if vsz, err = unix.Lgetxattr(path, name, val); err != nil {
					continue
				}
			}
			if !wrote {
				fmt.Fprintf(out, "# file: \"%s\"\n", escape(path))
				wrote = true
			}
			if vsz == 0 {
				fmt.Fprintf(out, "%s\n", name)
			} else {
				fmt.Fprintf(out, "%s=0x%x\n", name, val[:vsz])
			}
		}
		if wrote {
			fmt.Fprintln(out)
		}
		return nil
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
