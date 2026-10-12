type Props = {
  isDir?: boolean
  filename: string
  className?: string
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** Hub-style outline file/folder glyph. */
export function FileIcon({ isDir, filename, className = '' }: Props) {
  const ext = extOf(filename)
  const kind = isDir
    ? 'dir'
    : ['md', 'markdown', 'txt', 'rst'].includes(ext)
      ? 'doc'
      : ['csv', 'tsv', 'parquet', 'json', 'jsonl'].includes(ext)
        ? 'data'
        : ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)
          ? 'image'
          : [
                'py',
                'ts',
                'tsx',
                'js',
                'jsx',
                'rs',
                'go',
                'java',
                'c',
                'cpp',
                'h',
              ].includes(ext)
            ? 'code'
            : 'file'

  return (
    <svg
      className={`file-icon file-icon-${kind} ${className}`.trim()}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
    >
      {kind === 'dir' ? (
        <path
          fill="currentColor"
          d="M1.75 2.5A1.75 1.75 0 0 0 0 4.25v7.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 16 11.75v-5.5A1.75 1.75 0 0 0 14.25 4.5H8.06l-.97-1.293A1.75 1.75 0 0 0 5.69 2.5H1.75Zm0 1.5h3.94c.1 0 .19.05.24.13l.63.84H1.75a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25H1.75Z"
        />
      ) : kind === 'doc' ? (
        <path
          fill="currentColor"
          d="M3.75 1.5A1.75 1.75 0 0 0 2 3.25v9.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 12.75v-7.19c0-.464-.184-.908-.51-1.234L10.67 1.51A1.75 1.75 0 0 0 9.44 1H3.75Zm5.69 1.56L12.44 6H10.5a1 1 0 0 1-1-1V3.06ZM5 9.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 9.25Zm0 2.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M3.75 1.5A1.75 1.75 0 0 0 2 3.25v9.5c0 .966.784 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 12.75V6.31c0-.464-.184-.908-.51-1.234L10.17 1.76A1.75 1.75 0 0 0 8.94 1.25H3.75Zm5.69 1.56L12.44 6H10a1 1 0 0 1-1-1V3.06Z"
        />
      )}
    </svg>
  )
}
