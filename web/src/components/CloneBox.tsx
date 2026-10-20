import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { fetchCliInfo, viteOxenRemote } from '../lib/tokens'

type Props = {
  namespace: string
  repo: string
}

type SectionKey = 'login' | 'oxen' | 'python' | 'auth'

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
  const authCmd = `oxen config --auth ${authHost} <PAT>`
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
            <span className="clone-copy-label">{copied === 'login' ? 'Copied' : ''}</span>
            <Copy size={16} />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{loginCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          Opens a browser to authorize the Mice CLI. Traffic goes through the
          auth BFF (not raw oxen-server).
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
            <span className="clone-copy-label">{copied === 'oxen' ? 'Copied' : ''}</span>
            <Copy size={16} />
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
            <span className="clone-copy-label">
              {copied === 'python' ? 'Copied' : ''}
            </span>
            <Copy size={16} />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{pythonCmd}</code>
        </pre>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Automation PAT</b>
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
            <Copy size={16} />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{authCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          For CI: create a PAT under Settings → CLI tokens, then configure oxen
          against the BFF host.
        </p>
      </section>
    </div>
  )
}
