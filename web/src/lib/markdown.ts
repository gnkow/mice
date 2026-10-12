/** Minimal safe Markdown → HTML (GFM-ish subset). No raw HTML passthrough. */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const EMOJI: Record<string, string> = {
  smile: '😄',
  tada: '🎉',
  rocket: '🚀',
  warning: '⚠️',
  white_check_mark: '✅',
  x: '❌',
  eyes: '👀',
  bug: '🐛',
  memo: '📝',
  sparkles: '✨',
}

function inline(s: string): string {
  let out = escapeHtml(s)
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
  )
  out = out.replace(/:([a-z0-9_+-]+):/g, (full, name: string) => EMOJI[name] ?? full)
  return out
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let i = 0
  let inCode: string | null = null
  let codeBuf: string[] = []
  let listType: 'ul' | 'ol' | null = null

  function closeList() {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    if (inCode !== null) {
      if (line.startsWith('```')) {
        html.push(
          `<pre class="md-code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`,
        )
        inCode = null
        codeBuf = []
      } else {
        codeBuf.push(line)
      }
      i++
      continue
    }

    if (line.startsWith('```')) {
      closeList()
      inCode = line.slice(3).trim() || 'text'
      codeBuf = []
      i++
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      i++
      continue
    }

    if (line.startsWith('> ')) {
      closeList()
      html.push(`<blockquote><p>${inline(line.slice(2))}</p></blockquote>`)
      i++
      continue
    }

    if (/^---+$/.test(line.trim())) {
      closeList()
      html.push('<hr />')
      i++
      continue
    }

    const ul = /^[-*]\s+(.+)$/.exec(line)
    if (ul) {
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${inline(ul[1])}</li>`)
      i++
      continue
    }

    const ol = /^(\d+)\.\s+(.+)$/.exec(line)
    if (ol) {
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${inline(ol[2])}</li>`)
      i++
      continue
    }

    if (line.trim() === '') {
      closeList()
      i++
      continue
    }

    closeList()
    html.push(`<p>${inline(line)}</p>`)
    i++
  }

  if (inCode !== null) {
    html.push(
      `<pre class="md-code"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`,
    )
  }
  closeList()
  return html.join('\n')
}
