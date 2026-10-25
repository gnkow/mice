import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { SqliteBackend } from './sqliteBackend.js'

const MARKER = '.legacy-import'
const ARCHIVE_DIR = 'legacy-import'
const APPEND_ONLY = new Set(['audit.jsonl', 'audit-checkpoints.jsonl', 'audit-keys.jsonl'])
// Store files live directly in these directories; everything deeper (workspaces, checkouts, logs) stays on disk.
// Logs that rewrote themselves to change one record: now collections, latest record per id, first-seen order.
export const KEYED_LOGS = new Set(['jobs.jsonl', 'sessions.jsonl', 'lineage.jsonl'])
const isKeyed = (rel: string) => KEYED_LOGS.has(rel.split('/').pop()!)
const STORE_DIRS = ['', 'jobs', 'sessions']

export type LegacyImportReport = { imported: boolean; documents: number; logs: number; rows: number; partialLines: string[] }

type Found = { rel: string; abs: string; kind: 'document' | 'log' }

function discover(dataDir: string): Found[] {
  const found: Found[] = []
  for (const sub of STORE_DIRS) {
    const base = join(dataDir, sub)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) {
      const abs = join(base, name)
      if (!/\.jsonl?$/.test(name) || name.includes('.legacy') || !statSync(abs).isFile()) continue
      found.push({ rel: relative(dataDir, abs).split('\\').join('/'), abs, kind: name.endsWith('.jsonl') ? 'log' : 'document' })
    }
  }
  return found.sort((a, b) => a.rel.localeCompare(b.rel))
}

/** Moves a legacy file into the archive; bind-mounted directories cannot be renamed across, so fall back to copy and delete. */
function archive(dataDir: string, rel: string): void {
  const abs = join(dataDir, rel)
  if (!existsSync(abs)) return
  let target = join(dataDir, ARCHIVE_DIR, rel)
  if (existsSync(target)) target = `${target}.${Date.now()}`
  mkdirSync(dirname(target), { recursive: true })
  try {
    renameSync(abs, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    copyFileSync(abs, target)
    unlinkSync(abs)
  }
}

/** Complete, non-blank lines: the same rows the file readers returned. A trailing unterminated line is a torn write. */
function completeLines(text: string): { lines: string[]; partial: boolean } {
  const end = text.lastIndexOf('\n') + 1
  return {
    lines: text.slice(0, end).split('\n').map((l) => l.trim()).filter(Boolean),
    partial: text.slice(end).trim() !== '',
  }
}

/**
 * One-time move of the legacy JSON/JSONL files into the database. Rows are copied verbatim (so audit hashes
 * are untouched), verified against the source inside the transaction, and only then are the originals moved
 * into `legacy-import/`. Any failure rolls back and leaves the files in place for the caller to refuse startup.
 */
export function importLegacyData(dataDir: string, db: SqliteBackend): LegacyImportReport {
  const report: LegacyImportReport = { imported: false, documents: 0, logs: 0, rows: 0, partialLines: [] }
  const marker = db.read(join(dataDir, MARKER))
  if (marker !== undefined) {
    // A previous boot committed the import but may have died before archiving; finish that, never re-import.
    const done = (JSON.parse(marker) as { files?: string[] }).files ?? []
    for (const rel of done) archive(dataDir, rel)
    return report
  }
  const files = discover(dataDir)
  if (files.length === 0) return report

  for (const f of files) {
    const exists =
      f.kind === 'document' ? db.read(f.abs) !== undefined : isKeyed(f.rel) ? db.rowList(f.abs).length > 0 : db.lastSeq(f.abs) > 0
    if (exists) throw new Error(`Legacy import refused: the database already holds ${f.rel}; resolve the duplicate by hand before starting`)
  }

  db.atomically(() => {
    for (const f of files) {
      const text = readFileSync(f.abs, 'utf8')
      if (f.kind === 'document') {
        db.write(f.abs, text)
        if (db.read(f.abs) !== text) throw new Error(`Legacy import verification failed for ${f.rel}`)
        report.documents += 1
        continue
      }
      const { lines, partial } = completeLines(text)
      if (partial) report.partialLines.push(f.rel)
      if (isKeyed(f.rel)) {
        for (const line of lines) {
          try {
            const id = (JSON.parse(line) as { id?: unknown }).id
            if (typeof id === 'string' && id) db.rowPut(f.abs, id, line)
          } catch {
            /* corrupt line: skipped, as the readers did */
          }
        }
        report.logs += 1
        report.rows += lines.length
        continue
      }
      if (APPEND_ONLY.has(f.rel)) db.protectLog(f.abs)
      for (const line of lines) db.append(f.abs, `${line}\n`)
      const stored = db.readLines(f.abs, 0).map((r) => r.line)
      if (stored.length !== lines.length || stored.some((l, i) => l !== lines[i])) {
        throw new Error(`Legacy import verification failed for ${f.rel}`)
      }
      report.logs += 1
      report.rows += lines.length
    }
    db.write(
      join(dataDir, MARKER),
      JSON.stringify({ importedAt: new Date().toISOString(), files: files.map((f) => f.rel), partialLines: report.partialLines }),
    )
  })

  for (const f of files) archive(dataDir, f.rel)
  report.imported = true
  return report
}
