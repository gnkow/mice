import {
  Folder,
  FileText,
  FileSpreadsheet,
  Image,
  FileCode,
  File,
  type LucideProps,
} from 'lucide-react'

type Props = {
  isDir?: boolean
  filename: string
  className?: string
  size?: number
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

/**
 * File/folder icon using Lucide icons (open-source).
 * Automatically selects the appropriate icon based on file extension.
 */
export function FileIcon({ isDir, filename, className = '', size = 16 }: Props) {
  const ext = extOf(filename)
  
  const iconProps: LucideProps = {
    size,
    className: `file-icon ${className}`.trim(),
  }
  
  // Directory
  if (isDir) {
    return <Folder {...iconProps} className={`file-icon file-icon-dir ${className}`.trim()} />
  }
  
  // Document files
  if (['md', 'markdown', 'txt', 'rst', 'doc', 'docx'].includes(ext)) {
    return <FileText {...iconProps} className={`file-icon file-icon-doc ${className}`.trim()} />
  }
  
  // Data files
  if (['csv', 'tsv', 'parquet', 'json', 'jsonl', 'xlsx', 'xls'].includes(ext)) {
    return <FileSpreadsheet {...iconProps} className={`file-icon file-icon-data ${className}`.trim()} />
  }
  
  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return <Image {...iconProps} className={`file-icon file-icon-image ${className}`.trim()} />
  }
  
  // Code files
  if ([
    'py', 'ts', 'tsx', 'js', 'jsx', 'rs', 'go', 'java', 'c', 'cpp', 'h',
    'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'r', 'sh', 'bash',
  ].includes(ext)) {
    return <FileCode {...iconProps} className={`file-icon file-icon-code ${className}`.trim()} />
  }
  
  // Generic file
  return <File {...iconProps} className={`file-icon file-icon-file ${className}`.trim()} />
}
