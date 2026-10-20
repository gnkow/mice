/**
 * Icon exports using Lucide Icons (open-source, ISC License)
 * 
 * This file provides convenient re-exports and wrappers for commonly used icons.
 * All icons are from lucide-react for consistency and open-source compliance.
 */

import {
  Lock,
  EyeOff,
  Globe,
  Star,
  Database,
  FileText,
  Package,
  Table,
  Image as ImageIcon,
  Music,
  Video,
  File,
  Download,
  History,
  ExternalLink,
  RefreshCw,
  Trash2,
  RotateCcw,
  MoreHorizontal,
  Pencil,
  Hash,
  GitGraph,
  Box,
  type LucideProps,
} from 'lucide-react'

// Base icon props type
export type IconProps = LucideProps & {
  size?: number
  className?: string
  title?: string
}

// Re-export with consistent naming
export { Lock as LockIcon }
export { EyeOff as EyeClosedIcon }
export { Globe as GlobeIcon }
export { Database as SizeIcon }
export { FileText as TextTypeIcon }
export { Package as BinaryTypeIcon }
export { Table as TabularTypeIcon }
export { ImageIcon as ImageTypeIcon }
export { Music as AudioTypeIcon }
export { Video as VideoTypeIcon }
export { File as FileTypeIcon }
export { Download as DownloadIcon }
export { History as HistoryIcon }
export { ExternalLink as RawIcon }
export { RefreshCw as RefreshIcon }
export { Trash2 as TrashIcon }
export { RotateCcw as RestoreIcon }
export { MoreHorizontal as MoreIcon }
export { Pencil as EditIcon }
export { Hash as HashIcon }
export { Package as PackageIcon }
export { GitGraph as GraphIcon }

// Star icon with variants
export function StarIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return <Star {...props} fill={filled ? 'currentColor' : 'none'} />
}

// Visibility icon - dynamic based on visibility level
export function VisibilityIcon({
  visibility,
  ...props
}: IconProps & { visibility: 'local' | 'private' | 'public' }) {
  if (visibility === 'public') {
    return <Globe {...props} />
  }
  return <EyeOff {...props} />
}

// Data type icon - smart selector based on type string
export function DataTypeIcon({
  type,
  ...props
}: IconProps & { type: string }) {
  const t = type.toLowerCase()
  
  if (t.includes('text') || t.includes('string')) {
    return <FileText {...props} />
  }
  if (t.includes('tabular') || t.includes('table') || t.includes('dataframe')) {
    return <Table {...props} />
  }
  if (t.includes('image') || t.includes('picture')) {
    return <ImageIcon {...props} />
  }
  if (t.includes('audio') || t.includes('sound')) {
    return <Music {...props} />
  }
  if (t.includes('video')) {
    return <Video {...props} />
  }
  if (t.includes('binary') || t.includes('package')) {
    return <Package {...props} />
  }
  
  return <File {...props} />
}

// Brand icon - box logo
export function BrandIcon(props: IconProps) {
  return <Box {...props} />
}
