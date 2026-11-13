import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { fetchCliInfo, viteOxenRemote } from '../lib/tokens'

type Props = {
  namespace: string
  repo: string
}

type SectionKey = 'login' | 'oxen' | 'python'

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

  const loginCmd = 'mice login'
  const miceCloneCmd = `mice clone ${target}`
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
      <section className="clone-section" data-testid="clone-device-credentials">
        <div className="clone-section-head">
          <b>Sign in (CLI)</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('login', loginCmd)}
            title={copied === 'login' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'login' ? 'Copied login command' : 'Copy login command'
            }
          >
            <Copy size={16} aria-hidden />
            <span className="clone-copy-label">{copied === 'login' ? 'Copied' : ''}</span>
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{loginCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          Opens a browser to authorize short-lived CLI device credentials (not a personal
          access token). Traffic goes through the auth BFF at{' '}
          <span className="mono">{authHost}</span>. Revoke credentials under Profile → Access.
        </p>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Mice</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('oxen', miceCloneCmd)}
            title={copied === 'oxen' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'oxen' ? 'Copied clone command' : 'Copy clone command'
            }
          >
            <Copy size={16} aria-hidden />
            <span className="clone-copy-label">{copied === 'oxen' ? 'Copied' : ''}</span>
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{miceCloneCmd}</code>
        </pre>
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
              copied === 'python'
                ? 'Copied Python snippet'
                : 'Copy Python snippet'
            }
          >
            <Copy size={16} aria-hidden />
            <span className="clone-copy-label">
              {copied === 'python' ? 'Copied' : ''}
            </span>
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{pythonCmd}</code>
        </pre>
      </section>
    </div>
  )
}
