import { renderMarkdown } from '../lib/markdown'

type Props = {
  source: string
  className?: string
}

export function Markdown({ source, className = 'markdown-body' }: Props) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  )
}
