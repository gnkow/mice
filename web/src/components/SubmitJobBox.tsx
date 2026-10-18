import { useEffect, useMemo, useState } from 'react'
import { fetchCliInfo, viteOxenRemote } from '../lib/tokens'

type Props = {
  namespace: string
  repo: string
  /** Which runner tab to show first. */
  initialMode?: Mode
}

type Mode = 'local' | 'cluster'
type SectionKey = string

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

type CmdSection = {
  key: SectionKey
  title: string
  cmd: string
  hint: string
}

/** Clone-style copyable examples for submitting a job (Local CLI vs Cluster). */
export function SubmitJobBox({
  namespace,
  repo,
  initialMode = 'local',
}: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [copied, setCopied] = useState<SectionKey | null>(null)
  const [remote, setRemote] = useState(
    () => viteOxenRemote() ?? 'http://localhost:8080',
  )

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

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

  const ns = namespace || '<namespace>'
  const r = repo || '<repo>'
  const remoteBase = remote.replace(/\/$/, '')
  const cloneUrl = `${remoteBase}/${ns}/${r}`

  const localSections = useMemo((): CmdSection[] => {
    const setup = [
      'boxen login',
      `boxen clone ${cloneUrl}`,
      `cd ${r}`,
    ].join('\n')

    const run = [
      'boxen job run \\',
      '  --name my-job \\',
      '  --image alpine:3.20 \\',
      '  -- sh -c \'echo hello > out.txt\'',
    ].join('\n')

    const runPush = [
      'boxen job run --push \\',
      '  --name my-job \\',
      '  --image alpine:3.20 \\',
      '  -- sh -c \'echo hello > out.txt\'',
    ].join('\n')

    const push = ['boxen push', '# publishes pending job metadata for commits on the tip'].join(
      '\n',
    )

    return [
      {
        key: 'local-setup',
        title: 'Sign in + clone',
        cmd: setup,
        hint: 'Authorize the CLI in the browser, then clone through the auth BFF. Namespace, repo, and source branch are detected from the clone.',
      },
      {
        key: 'local-run',
        title: 'Run (local only)',
        cmd: run,
        hint: 'Runs Docker on your machine and commits on the source branch. Job metadata stays in ~/.boxen/jobs/ — nothing appears on the remote/UI until you push.',
      },
      {
        key: 'local-run-push',
        title: 'Run and push',
        cmd: runPush,
        hint: 'After the local commit, runs boxen push (via BFF). Job metadata for result commits on the tip is published automatically.',
      },
      {
        key: 'local-push',
        title: 'Push later',
        cmd: push,
        hint: 'Ordinary boxen push through the auth BFF. Any unpublished local jobs whose result commit is on the pushed tip are published to the UI.',
      },
    ]
  }, [cloneUrl, r])

  const clusterSections = useMemo((): CmdSection[] => {
    const setup = [
      '# Settings → CLI tokens → Create token',
      'export BOXEN_PAT=boxen_pat_…',
      `export BOXEN_REMOTE=${remoteBase}`,
      '# optional: boxen login  (for status/logs without exporting PAT)',
    ].join('\n')

    const submit = [
      'curl -sS -X POST "$BOXEN_REMOTE/auth/jobs" \\',
      '  -H "Authorization: Bearer $BOXEN_PAT" \\',
      '  -H "Content-Type: application/json" \\',
      "  -d '{",
      `    "namespace": "${ns}",`,
      `    "repo": "${r}",`,
      '    "name": "my-job",',
      '    "source": "main",',
      '    "image": "alpine:3.20",',
      '    "command": ["sh", "-c"],',
      '    "args": ["echo hello > /data/out.txt"]',
      "  }'",
    ].join('\n')

    const follow = [
      'boxen job status --id <jobId>',
      'boxen job logs --id <jobId>',
      'boxen job cancel --id <jobId>',
    ].join('\n')

    return [
      {
        key: 'cluster-setup',
        title: 'Auth',
        cmd: setup,
        hint: 'Cluster jobs run on the auth BFF (Docker or Kubernetes via JOBS_RUNNER). Mint a PAT under Settings → CLI tokens for the submit call.',
      },
      {
        key: 'cluster-submit',
        title: 'Submit to cluster',
        cmd: submit,
        hint: 'Queues a job on the server. Container workdir is /data (repo checkout at source). The BFF picks the runner from JOBS_RUNNER.',
      },
      {
        key: 'cluster-follow',
        title: 'Status & logs',
        cmd: follow,
        hint: 'Use the job id from the JSON response. Status/logs work after boxen login or with BOXEN_PAT set.',
      },
    ]
  }, [remoteBase, ns, r])

  const sections = mode === 'local' ? localSections : clusterSections

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
      <div className="tab-bar" role="tablist" aria-label="Job runner">
        <button
          type="button"
          role="tab"
          className={mode === 'local' ? 'active' : ''}
          aria-selected={mode === 'local'}
          onClick={() => {
            setMode('local')
            setCopied(null)
          }}
        >
          Local
        </button>
        <button
          type="button"
          role="tab"
          className={mode === 'cluster' ? 'active' : ''}
          aria-selected={mode === 'cluster'}
          onClick={() => {
            setMode('cluster')
            setCopied(null)
          }}
        >
          Cluster
        </button>
      </div>

      <p className="clone-hint muted small submit-job-mode-hint">
        {mode === 'local' ? (
          <>
            <span className="pill runner-local">Local</span> Run with{' '}
            <span className="mono">boxen job run</span> on your machine (Docker
            + local oxen commit). Best for iteration.
          </>
        ) : (
          <>
            <span className="pill runner-cluster">Cluster</span> Queue on the
            auth BFF — executed where{' '}
            <span className="mono">JOBS_RUNNER</span> points (Docker on the
            host or Kubernetes).
          </>
        )}
      </p>

      {sections.map((s) => (
        <section key={s.key} className="clone-section">
          <div className="clone-section-head">
            <b>{s.title}</b>
            <button
              type="button"
              className="clone-copy"
              onClick={() => void copy(s.key, s.cmd)}
              title={copied === s.key ? 'Copied' : 'Copy'}
              aria-label={
                copied === s.key
                  ? `Copied ${s.title} commands`
                  : `Copy ${s.title} commands`
              }
            >
              <span className="clone-copy-label">
                {copied === s.key ? 'Copied' : ''}
              </span>
              <CopyIcon />
            </button>
          </div>
          <pre className="clone-code mono">
            <code>{s.cmd}</code>
          </pre>
          <p className="clone-hint muted small">{s.hint}</p>
        </section>
      ))}
    </div>
  )
}
