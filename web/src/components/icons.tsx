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
