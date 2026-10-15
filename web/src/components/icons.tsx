import type { ReactNode } from 'react'

type IconProps = {
  size?: number
  className?: string
  title?: string
}

function Svg({
  size = 14,
  className,
  title,
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/** Lock — breadcrumb visibility glyph. */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M4.5 6V4.5a3.5 3.5 0 1 1 7 0V6h.75A1.75 1.75 0 0 1 14 7.75v5.5A1.75 1.75 0 0 1 12.25 15H3.75A1.75 1.75 0 0 1 2 13.25v-5.5A1.75 1.75 0 0 1 3.75 6H4.5Zm1.5 0h4V4.5a2 2 0 1 0-4 0V6Z"
      />
    </Svg>
  )
}

/** Closed eye — private / local pill (Hub-style). */
export function EyeClosedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M1.06 1.06a.75.75 0 0 1 1.06 0l12.82 12.82a.75.75 0 1 1-1.06 1.06l-2.12-2.12A9.4 9.4 0 0 1 8 13.75c-3.7 0-6.6-2.05-8.05-3.85A2.7 2.7 0 0 1 0 8c0-.55.2-1.1.55-1.55.55-.7 1.35-1.5 2.4-2.2L1.06 2.12a.75.75 0 0 1 0-1.06ZM4.2 5.26l1.4 1.4a2.25 2.25 0 0 0 3.04 3.04l1.15 1.15A8 8 0 0 1 8 12.25c-2.85 0-5.15-1.45-6.55-2.95A1.2 1.2 0 0 1 1.5 8c0-.25.1-.55.3-.85.55-.8 1.55-1.7 2.9-2.35l-.5-.54Zm9.55 4.9-1.2-1.2c.35-.4.65-.8.9-1.15.2-.3.3-.6.3-.81 0-.25-.1-.55-.3-.85-.9-1.25-2.55-2.55-4.7-3.05l1.2-1.2A9.5 9.5 0 0 1 15.45 6.45 2.7 2.7 0 0 1 16 8c0 .55-.2 1.05-.5 1.5-.25.35-.55.7-.9 1.05l-.85-.4Z"
      />
    </Svg>
  )
}

/** Globe — public visibility. */
export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM2.98 7.25h2.14c.1-1.48.5-2.82 1.1-3.9A5.01 5.01 0 0 0 2.98 7.25Zm2.14 1.5H2.98a5.01 5.01 0 0 0 3.24 3.9c-.6-1.08-1-2.42-1.1-3.9Zm1.5 0c.1 1.7.55 3.2 1.2 4.2.2.3.4.45.68.45s.48-.15.68-.45c.65-1 .1-2.5 1.2-4.2H6.62Zm2.76-1.5c-.1-1.7-.55-3.2-1.2-4.2A.9.9 0 0 0 8 2.6c-.28 0-.48.15-.68.45-.65 1-1.1 2.5-1.2 4.2h3.26Zm1.5 0h2.14a5.01 5.01 0 0 0-3.24-3.9c.6 1.08 1 2.42 1.1 3.9Zm0 1.5c-.1 1.48-.5 2.82-1.1 3.9a5.01 5.01 0 0 0 3.24-3.9h-2.14Z"
      />
    </Svg>
  )
}

/** Pill icon: closed eye for local/private, globe for public. */
export function VisibilityIcon({
  visibility = 'local',
  ...props
}: IconProps & { visibility?: 'local' | 'private' | 'public' }) {
  if (visibility === 'public') return <GlobeIcon {...props} />
  return <EyeClosedIcon {...props} />
}

/** Outline or filled star for starring. */
export function StarIcon({
  filled = false,
  ...props
}: IconProps & { filled?: boolean }) {
  if (filled) {
    return (
      <Svg {...props}>
        <path
          fill="currentColor"
          d="M8 .75a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.802l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.82 6.874a.75.75 0 0 1 .416-1.28l4.21-.611L7.327 1.17A.75.75 0 0 1 8 .75Z"
        />
      </Svg>
    )
  }
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M8 .75a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.802l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.82 6.874a.75.75 0 0 1 .416-1.28l4.21-.611L7.327 1.17A.75.75 0 0 1 8 .75Zm0 2.445L6.615 5.95a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 3.195Z"
      />
    </Svg>
  )
}

/** Database / size chip. */
export function SizeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M8 1.5c-2.9 0-5.25 1.12-5.25 2.5v8c0 1.38 2.35 2.5 5.25 2.5s5.25-1.12 5.25-2.5v-8c0-1.38-2.35-2.5-5.25-2.5Zm0 1.5c2.3 0 3.75.8 3.75 1s-1.45 1-3.75 1S4.25 4.2 4.25 4 5.7 3 8 3Zm3.75 3.1c0 .2-1.45 1-3.75 1s-3.75-.8-3.75-1V4.95c.7.4 2.05.8 3.75.8s3.05-.4 3.75-.8V6.1Zm0 3c0 .2-1.45 1-3.75 1s-3.75-.8-3.75-1V7.95c.7.4 2.05.8 3.75.8s3.05-.4 3.75-.8V9.1Z"
      />
    </Svg>
  )
}

/** Text document. */
export function TextTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.75 1.5A1.75 1.75 0 0 0 2 3.25v9.5c0 .97.78 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 12.75v-7.19c0-.46-.18-.9-.51-1.23L10.67 1.5A1.75 1.75 0 0 0 9.44 1H3.75Zm5.69 1.56L12.44 6H10.5a1 1 0 0 1-1-1V3.06ZM3.5 3.25c0-.14.11-.25.25-.25H8V5a2.5 2.5 0 0 0 2.5 2.5h2.75v5.25c0 .14-.11.25-.25.25h-8.5a.25.25 0 0 1-.25-.25v-9.5ZM5 9.75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 9.75Zm0 2.5a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z"
      />
    </Svg>
  )
}

/** Binary / package. */
export function BinaryTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M7.68 1.35a1.5 1.5 0 0 1 1.64.03l4.5 2.88A1.5 1.5 0 0 1 14.5 5.5v5a1.5 1.5 0 0 1-.68 1.24l-4.5 2.88a1.5 1.5 0 0 1-1.64 0l-4.5-2.88A1.5 1.5 0 0 1 2.5 10.5v-5c0-.52.27-1 .68-1.24l4.5-2.91ZM8.5 2.7 4 5.58v4.84l4.5 2.88 4.5-2.88V5.58L8.5 2.7Z"
      />
    </Svg>
  )
}

/** Tabular / spreadsheet. */
export function TabularTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M2.5 2.75A1.75 1.75 0 0 1 4.25 1h7.5c.97 0 1.75.78 1.75 1.75v10.5A1.75 1.75 0 0 1 11.75 15h-7.5A1.75 1.75 0 0 1 2.5 13.25V2.75ZM4.25 2.5a.25.25 0 0 0-.25.25V5h8V2.75a.25.25 0 0 0-.25-.25h-7.5ZM12 6.5H9.5v2.5H12v-2.5Zm0 4H9.5v3.75h2.25a.25.25 0 0 0 .25-.25V10.5ZM8 10.5H4v2.75c0 .14.11.25.25.25H8V10.5Zm0-1.5V6.5H4v2.5h4Z"
      />
    </Svg>
  )
}

/** Image. */
export function ImageTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M2.75 2A1.75 1.75 0 0 0 1 3.75v8.5C1 13.22 1.78 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25v-8.5A1.75 1.75 0 0 0 13.25 2H2.75Zm-.25 1.75c0-.14.11-.25.25-.25h10.5c.14 0 .25.11.25.25v5.69l-2.22-2.22a.75.75 0 0 0-1.06 0L5.72 11.78 4.28 10.34a.75.75 0 0 0-1.06 0L2.5 11.06V3.75ZM5 6.25a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z"
      />
    </Svg>
  )
}

/** Audio. */
export function AudioTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M7.25 1.5a.75.75 0 0 1 .75.75v8.19a2.5 2.5 0 1 1-1.5-2.28V3.56L12 2.3v6.39a2.5 2.5 0 1 1-1.5-2.28V1.75a.75.75 0 0 1 .9-.73l4 1.1A.75.75 0 0 1 16 2.85v6.9a.75.75 0 0 1-1.5 0V3.64l-3.5.96v5.15a.75.75 0 0 1-1.5 0V2.25a.75.75 0 0 1 .6-.73l-2.85.79V2.25a.75.75 0 0 1 .75-.75ZM5 12.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm7.5 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
      />
    </Svg>
  )
}

/** Video. */
export function VideoTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M1.75 3A1.75 1.75 0 0 0 0 4.75v6.5C0 12.22.78 13 1.75 13h8.5A1.75 1.75 0 0 0 12 11.25v-1.1l2.72 1.63A.75.75 0 0 0 16 11.13V4.87a.75.75 0 0 0-1.28-.62L12 5.85v-1.1A1.75 1.75 0 0 0 10.25 3h-8.5ZM10.5 6.72l4-2.4v7.36l-4-2.4V6.72ZM1.5 4.75c0-.14.11-.25.25-.25h8.5c.14 0 .25.11.25.25v6.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-6.5Z"
      />
    </Svg>
  )
}

/** Generic file. */
export function FileTypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.75 1.5A1.75 1.75 0 0 0 2 3.25v9.5c0 .97.78 1.75 1.75 1.75h8.5A1.75 1.75 0 0 0 14 12.75V6.31c0-.46-.18-.9-.51-1.23L10.17 1.76A1.75 1.75 0 0 0 8.94 1.25H3.75Zm5.69 1.56L12.44 6H10a1 1 0 0 1-1-1V3.06ZM3.5 3.25c0-.14.11-.25.25-.25H8V5a2.5 2.5 0 0 0 2.5 2.5h2.75v5.25a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-9.5Z"
      />
    </Svg>
  )
}

export function normalizeDataType(type: string): string {
  return type.trim().toLowerCase()
}

export function DataTypeIcon({
  type,
  ...props
}: IconProps & { type: string }) {
  const t = normalizeDataType(type)
  if (t.includes('text') || t.includes('markdown') || t === 'doc') {
    return <TextTypeIcon {...props} className={`dtype-icon dtype-text ${props.className ?? ''}`.trim()} />
  }
  if (t.includes('tabular') || t.includes('table') || t.includes('dataframe')) {
    return <TabularTypeIcon {...props} className={`dtype-icon dtype-tabular ${props.className ?? ''}`.trim()} />
  }
  if (t.includes('image') || t.includes('img')) {
    return <ImageTypeIcon {...props} className={`dtype-icon dtype-image ${props.className ?? ''}`.trim()} />
  }
  if (t.includes('audio')) {
    return <AudioTypeIcon {...props} className={`dtype-icon dtype-audio ${props.className ?? ''}`.trim()} />
  }
  if (t.includes('video')) {
    return <VideoTypeIcon {...props} className={`dtype-icon dtype-video ${props.className ?? ''}`.trim()} />
  }
  if (t.includes('binary') || t.includes('package') || t.includes('model')) {
    return <BinaryTypeIcon {...props} className={`dtype-icon dtype-binary ${props.className ?? ''}`.trim()} />
  }
  return <FileTypeIcon {...props} className={`dtype-icon dtype-file ${props.className ?? ''}`.trim()} />
}

export function visibilityLabel(visibility: 'local' | 'private' | 'public') {
  if (visibility === 'public') return 'public'
  if (visibility === 'private') return 'private'
  return 'local'
}

/** Download arrow into tray. */
export function DownloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M8.75 2.75a.75.75 0 0 0-1.5 0v6.19L5.03 6.72a.75.75 0 0 0-1.06 1.06l3.5 3.5a.75.75 0 0 0 1.06 0l3.5-3.5a.75.75 0 1 0-1.06-1.06L8.75 8.94V2.75ZM2.75 12a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H2.75Z"
      />
    </Svg>
  )
}

/** Clock / history. */
export function HistoryIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M1.5 8a6.5 6.5 0 1 1 2.02 4.64.75.75 0 0 1-.04-1.06.75.75 0 0 1 1.06-.04A5 5 0 1 0 3 8H4.5a.75.75 0 0 1 .53 1.28l-2 2a.75.75 0 0 1-1.06 0l-2-2A.75.75 0 0 1 .75 8H1.5Zm6.75-3a.75.75 0 0 1 .75.75v2.69l1.78 1.78a.75.75 0 1 1-1.06 1.06l-2-2A.75.75 0 0 1 7.5 8.75v-3A.75.75 0 0 1 8.25 5Z"
      />
    </Svg>
  )
}

/** External / raw view. */
export function RawIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3.75 2A1.75 1.75 0 0 0 2 3.75v8.5C2 13.22 2.78 14 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-2.5a.75.75 0 0 0-1.5 0v2.5a.25.25 0 0 1-.25.25h-8.5a.25.25 0 0 1-.25-.25v-8.5c0-.14.11-.25.25-.25H6a.75.75 0 0 0 0-1.5H3.75Zm6.47.22a.75.75 0 0 1 1.06 0l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 1 1-1.06-1.06L12.44 7H8.75a.75.75 0 0 1 0-1.5h3.69L10.22 3.28a.75.75 0 0 1 0-1.06Z"
      />
    </Svg>
  )
}

/** Refresh / sync. */
export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M8 2.5a5.5 5.5 0 0 0-4.66 2.5H4.5a.75.75 0 0 1 0 1.5h-3A.75.75 0 0 1 .75 5.75v-3a.75.75 0 0 1 1.5 0v.84A7 7 0 1 1 1 8a.75.75 0 0 1 1.5 0A5.5 5.5 0 1 0 8 2.5Z"
      />
    </Svg>
  )
}

/** Trash / delete. */
export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M6.5 1.75A.75.75 0 0 1 7.25 1h1.5a.75.75 0 0 1 .75.75V3h3.75a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H6.5V1.75ZM3.87 5.5h8.26l-.45 8.09a1.75 1.75 0 0 1-1.75 1.66H6.07a1.75 1.75 0 0 1-1.75-1.66L3.87 5.5Zm2.01 1.75a.75.75 0 0 0-1.5.08l.3 5.5a.75.75 0 0 0 1.5-.08l-.3-5.5Zm3.62-.67a.75.75 0 0 0-1.5 0v5.5a.75.75 0 0 0 1.5 0v-5.5Zm1.97.75a.75.75 0 1 0-1.5-.08l.3 5.5a.75.75 0 0 0 1.5-.08l-.3-5.34Z"
      />
    </Svg>
  )
}

/** Restore / bring back. */
export function RestoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M1.5 8a6.5 6.5 0 0 1 11.14-4.56.75.75 0 0 1-1.02 1.1A5 5 0 1 0 8 13H4.56l1.22-1.22a.75.75 0 1 0-1.06-1.06l-2.5 2.5a.75.75 0 0 0 0 1.06l2.5 2.5a.75.75 0 1 0 1.06-1.06L4.56 14.5H8A6.5 6.5 0 0 1 1.5 8Z"
      />
    </Svg>
  )
}

/** Ellipsis / more. */
export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M3 8a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 3 8Zm6.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM14.5 9.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z"
      />
    </Svg>
  )
}

/** Hash / fingerprint. */
export function HashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M5.09 3.75a.75.75 0 0 1 .74.64l.24 1.61h3.7l.28-1.86a.75.75 0 1 1 1.48.22l-.25 1.64h1.47a.75.75 0 0 1 0 1.5h-1.7l-.45 3h1.65a.75.75 0 0 1 0 1.5h-1.87l-.28 1.86a.75.75 0 1 1-1.48-.22l.25-1.64h-3.7l-.28 1.86a.75.75 0 1 1-1.48-.22l.25-1.64H2.75a.75.75 0 0 1 0-1.5h1.7l.45-3H3.25a.75.75 0 0 1 0-1.5h1.87l.28-1.86a.75.75 0 0 1 .69-.54Zm.98 3.75-.45 3h3.7l.45-3h-3.7Z"
      />
    </Svg>
  )
}

/** Package / version store. */
export function PackageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M7.68 1.35a1.5 1.5 0 0 1 1.64.03l4.5 2.88A1.5 1.5 0 0 1 14.5 5.5v5a1.5 1.5 0 0 1-.68 1.24l-4.5 2.88a1.5 1.5 0 0 1-1.64 0l-4.5-2.88A1.5 1.5 0 0 1 2.5 10.5v-5c0-.52.27-1 .68-1.24l4.5-2.91ZM8.5 2.7 4 5.58v.4l4.5 2.7 4.5-2.7v-.4L8.5 2.7Zm4 4.32-3.75 2.25v4.36l3.75-2.4V7.02Zm-5.25 2.25L3.5 7.02v4.21l3.75 2.4V9.27Z"
      />
    </Svg>
  )
}

/** Graph / lineage. */
export function GraphIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M4.5 2.75a1.75 1.75 0 1 1-1.3 2.92L2.06 7.25a1.75 1.75 0 1 1 0 1.5l1.14 1.58A1.75 1.75 0 1 1 4.5 13.25a1.75 1.75 0 0 1-.2-3.48l1.14-1.58a1.76 1.76 0 0 1 1.62-.19l2.2 1.1a1.75 1.75 0 1 1-.1 1.4l-2.2-1.1a.25.25 0 0 0-.23.03l-1.2 1.66c.1.2.17.42.17.66a1.75 1.75 0 1 1-1.3-2.92L5.34 7.9a.25.25 0 0 0 .23-.03l2.2-1.1a1.75 1.75 0 1 1 .1-1.4l-2.2 1.1a.25.25 0 0 0-.23-.03L4.3 4.78c.1-.2.17-.42.17-.66a1.75 1.75 0 0 1 .03-1.37Z"
      />
    </Svg>
  )
}

/** Pencil / edit. */
export function EditIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        fill="currentColor"
        d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.939-3.23c.082-.28.235-.537.445-.747l8.6-8.64Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.92 1.93-.552a.25.25 0 0 0 .106-.063l6.31-6.26Z"
      />
    </Svg>
  )
}
