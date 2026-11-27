import { useEffect, useId } from 'react'
import { qcStatusLabel, type CommitQcStatus } from '../lib/commitQc'
import {
  MERGE_COMMIT_DISPOSITION_KEY,
  coerceDispositionForSigner,
  signerAuthoredCommit,
  type DispositionCommitRow,
  type DispositionMap,
  type DispositionValue,
} from '../lib/disposition'

type Props = {
  rows: DispositionCommitRow[]
  value: DispositionMap
  onChange: (next: DispositionMap) => void
  /** Current signer — Valid is disabled when they authored the row. */
  signer?: { iss: string; sub: string } | null
  disabled?: boolean
  /** Heading override (default: Commit disposition). */
  heading?: string
}

/**
 * Per-commit Valid / Invalid picker for merge complete, mark-validated, and similar ceremonies.
 * Defaults come from the parent via `value` (typically all Valid).
 */
export function DispositionTable({
  rows,
  value,
  onChange,
  signer,
  disabled = false,
  heading = 'Commit disposition',
}: Props) {
  const headingId = useId()

  // Keep the map consistent with the self-Valid rule when signer/rows change.
  useEffect(() => {
    if (!signer || rows.length === 0) return
    const coerced = coerceDispositionForSigner(value, rows, signer)
    const changed = rows.some((r) => coerced[r.id] !== value[r.id])
    if (changed) onChange(coerced)
    // Only re-coerce when authorship constraints change, not on every parent keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer?.iss, signer?.sub, rows.map((r) => `${r.id}:${r.author}`).join('|')])

  if (rows.length === 0) return null

  function setOne(id: string, next: DispositionValue) {
    if (disabled) return
    onChange({ ...value, [id]: next })
  }

  return (
    <section
      className="disposition-table-section"
      aria-labelledby={headingId}
      data-testid="disposition-table"
    >
      <h3 id={headingId} className="reason-prompt-heading">
        {heading}
      </h3>
      <p className="muted small">
        Choose Valid or Invalid for each commit. Defaults are Valid. You cannot set Valid on
        commits you authored.
      </p>
      <table className="file-table disposition-table">
        <thead>
          <tr>
            <th>Commit</th>
            <th>Current</th>
            <th>Disposition</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const authored = signerAuthoredCommit(signer, row.author)
            const selected = value[row.id] ?? 'valid'
            const validBlocked = authored && selected !== 'invalid'
            return (
              <tr
                key={row.id}
                data-testid={
                  row.isMergeCommit || row.id === MERGE_COMMIT_DISPOSITION_KEY
                    ? 'disposition-row-merge'
                    : 'disposition-row'
                }
              >
                <td>
                  <span className="mono">{row.id === MERGE_COMMIT_DISPOSITION_KEY ? 'merge' : row.id.slice(0, 8)}</span>
                  {' '}
                  <span className="disposition-row-msg">
                    {row.isMergeCommit
                      ? 'Merge commit (created on complete)'
                      : row.message || '(no message)'}
                  </span>
                </td>
                <td className="muted small">
                  {row.isMergeCommit
                    ? '—'
                    : qcStatusLabel(row.currentQc as CommitQcStatus | undefined)}
                </td>
                <td>
                  <fieldset className="disposition-radios" disabled={disabled}>
                    <legend className="visually-hidden">
                      Disposition for {row.id.slice(0, 8)}
                    </legend>
                    <label className="disposition-radio">
                      <input
                        type="radio"
                        name={`disposition-${row.id}`}
                        checked={selected === 'valid'}
                        disabled={disabled || authored}
                        onChange={() => setOne(row.id, 'valid')}
                        data-testid={`disposition-valid-${row.id.slice(0, 8)}`}
                      />
                      Valid
                    </label>
                    <label className="disposition-radio">
                      <input
                        type="radio"
                        name={`disposition-${row.id}`}
                        checked={selected === 'invalid'}
                        disabled={disabled}
                        onChange={() => setOne(row.id, 'invalid')}
                        data-testid={`disposition-invalid-${row.id.slice(0, 8)}`}
                      />
                      Invalid
                    </label>
                  </fieldset>
                  {authored ? (
                    <p className="muted small disposition-author-note">
                      {validBlocked
                        ? 'You authored this commit — Valid is disabled; choose Invalid or have another signer disposition it.'
                        : 'You authored this commit — Valid is disabled.'}
                    </p>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
