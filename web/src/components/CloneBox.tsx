import { useEffect, useMemo, useState } from 'react'
import { fetchCliInfo, viteOxenRemote } from '../lib/tokens'

type Props = {
  namespace: string
  repo: string
}

type SectionKey = 'oxen' | 'python' | 'auth'

function CopyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path
        fill="currentColor"
        fillRule="nonzero"
        d="M28,10V28H10V10H28m0-2H10a2,2,0,0,0-2,2V28a2,2,0,0,0,2,2H28a2,2,0,0,0,2-2V10a2,2,0,0,0-2-2Z"
      />
      <path fill="currentColor" fillRule="nonzero" d="M4,18H2V4A2,2,0,0,1,4,2H18V4H4Z" />
    </svg>
  )
}

export function CloneBox({ namespace, repo }: Props) {
  const [copied, setCopied] = useState<SectionKey | null>(null)
  const [remote, setRemote] = useState(
    () => viteOxenRemote() ?? 'http://localhost:8080',
  )
  const [authHost, setAuthHost] = useState('localhost:8080')

  useEffect(() => {
    let cancelled = false
    fetchCliInfo()
      .then((info) => {
        if (cancelled) return
        setRemote(info.remote)
        setAuthHost(info.authHost)
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const target = useMemo(
    () => `${remote.replace(/\/$/, '')}/${namespace}/${repo}`,
    [remote, namespace, repo],
  )

  const authCmd = `oxen config --auth ${authHost} <PAT>`
  const oxenCmd = `oxen clone ${target}`
  const pythonCmd = `import oxen\noxen.clone("${target}")`

  async function copy(key: SectionKey, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1500)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="clone-box" role="menu" aria-label="Clone repository">
      <section className="clone-section">
        <div className="clone-section-head">
          <b>Auth (CLI token)</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('auth', authCmd)}
            title={copied === 'auth' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'auth' ? 'Copied auth command' : 'Copy auth command'
            }
          >
            <span className="clone-copy-label">{copied === 'auth' ? 'Copied' : ''}</span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{authCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          Create a PAT under Settings → CLI tokens. All CLI traffic goes through
          the auth BFF (not raw oxen-server).
        </p>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Oxen</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('oxen', oxenCmd)}
            title={copied === 'oxen' ? 'Copied' : 'Copy'}
            aria-label={copied === 'oxen' ? 'Copied Oxen clone command' : 'Copy Oxen clone command'}
          >
            <span className="clone-copy-label">{copied === 'oxen' ? 'Copied' : ''}</span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{oxenCmd}</code>
        </pre>
        <a
          className="clone-docs-link"
          href="https://docs.oxen.ai/getting-started/install#command-line-tools"
          target="_blank"
          rel="noreferrer"
        >
          Oxen CLI documentation
        </a>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Python</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('python', pythonCmd)}
            title={copied === 'python' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'python' ? 'Copied Python clone snippet' : 'Copy Python clone snippet'
            }
          >
            <span className="clone-copy-label">{copied === 'python' ? 'Copied' : ''}</span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>
            <span className="clone-kw">import</span> oxen{'\n'}
            oxen.clone(<span className="clone-str">"{target}"</span>)
          </code>
        </pre>
        <a
          className="clone-docs-link"
          href="https://docs.oxen.ai/getting-started/python"
          target="_blank"
          rel="noreferrer"
        >
          Oxen Python library documentation
        </a>
      </section>
    </div>
  )
}
