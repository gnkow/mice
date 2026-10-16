import { useEffect, useMemo, useState } from 'react'
import { fetchCliInfo, viteOxenRemote } from '../lib/tokens'

type Props = {
  namespace: string
  repo: string
}

type SectionKey = 'auth' | 'submit' | 'submitSync' | 'sync'

function CopyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path
        fill="currentColor"
        fillRule="nonzero"
        d="M28,10V28H10V10H28m0-2H10a2,2,0,0,0-2,2V28a2,2,0,0,0,2,2H28a2,2,0,0,0,2-2V10a2,2,0,0,0-2-2Z"
      />
      <path
        fill="currentColor"
        fillRule="nonzero"
        d="M4,18H2V4A2,2,0,0,1,4,2H18V4H4Z"
      />
    </svg>
  )
}

/** Clone-style copyable examples for submitting a job via `boxen job run`. */
export function SubmitJobBox({ namespace, repo }: Props) {
  const [copied, setCopied] = useState<SectionKey | null>(null)
  const [remote, setRemote] = useState(
    () => viteOxenRemote() ?? 'http://localhost:8080',
  )

  useEffect(() => {
    let cancelled = false
    fetchCliInfo()
      .then((info) => {
        if (cancelled) return
        setRemote(info.remote)
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ns = namespace || '<ns>'
  const r = repo || '<repo>'
  const remoteFlag = remote.replace(/\/$/, '')

  const authCmd = useMemo(
    () =>
      [
        '# Settings → CLI tokens → Create token',
        'export BOXEN_PAT=boxen_pat_…',
        `export BOXEN_REMOTE=${remoteFlag}`,
        `oxen clone ${remoteFlag}/${ns}/${r}`,
        `cd ${r}`,
      ].join('\n'),
    [remoteFlag, ns, r],
  )

  const submitCmd = useMemo(
    () =>
      [
        'boxen job run \\',
        '  --name my-job \\',
        '  --image alpine:3.20 \\',
        '  -- touch out.txt',
      ].join('\n'),
    [],
  )

  const submitSyncCmd = useMemo(
    () =>
      [
        'boxen job run --sync \\',
        '  --name my-job \\',
        '  --image alpine:3.20 \\',
        '  -- touch out.txt',
      ].join('\n'),
    [],
  )

  const syncCmd = useMemo(
    () =>
      [
        'boxen job sync',
        '# or: boxen job sync main --id <jobId>',
      ].join('\n'),
    [],
  )

  async function copy(key: SectionKey, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(
        () => setCopied((cur) => (cur === key ? null : cur)),
        1500,
      )
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="clone-box" role="region" aria-label="Submit job with CLI">
      <section className="clone-section">
        <div className="clone-section-head">
          <b>Auth + clone</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('auth', authCmd)}
            title={copied === 'auth' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'auth' ? 'Copied auth commands' : 'Copy auth commands'
            }
          >
            <span className="clone-copy-label">
              {copied === 'auth' ? 'Copied' : ''}
            </span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{authCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          Create a PAT under Settings → CLI tokens. Run jobs from inside the
          oxen clone (namespace/repo/source are detected automatically).
        </p>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Submit (local commit)</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('submit', submitCmd)}
            title={copied === 'submit' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'submit' ? 'Copied submit command' : 'Copy submit command'
            }
          >
            <span className="clone-copy-label">
              {copied === 'submit' ? 'Copied' : ''}
            </span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{submitCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          Runs Docker locally, commits results on the source branch. Does not
          push until you sync.
        </p>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Submit and sync</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('submitSync', submitSyncCmd)}
            title={copied === 'submitSync' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'submitSync'
                ? 'Copied submit-and-sync command'
                : 'Copy submit-and-sync command'
            }
          >
            <span className="clone-copy-label">
              {copied === 'submitSync' ? 'Copied' : ''}
            </span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{submitSyncCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          After commit, syncs to the job&apos;s source branch when a
          fast-forward or clean merge is possible; otherwise reports an error
          and leaves the remote unchanged.
        </p>
      </section>

      <section className="clone-section">
        <div className="clone-section-head">
          <b>Sync later</b>
          <button
            type="button"
            className="clone-copy"
            onClick={() => void copy('sync', syncCmd)}
            title={copied === 'sync' ? 'Copied' : 'Copy'}
            aria-label={
              copied === 'sync' ? 'Copied sync command' : 'Copy sync command'
            }
          >
            <span className="clone-copy-label">
              {copied === 'sync' ? 'Copied' : ''}
            </span>
            <CopyIcon />
          </button>
        </div>
        <pre className="clone-code mono">
          <code>{syncCmd}</code>
        </pre>
        <p className="clone-hint muted small">
          Syncs the latest local job (and ancestor jobs in the sequential chain)
          to the recorded source branch, or an explicit branch argument.
        </p>
      </section>
    </div>
  )
}
