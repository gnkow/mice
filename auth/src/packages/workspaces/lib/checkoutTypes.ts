/** Shared checkout types/helpers (keeps checkout ↔ maintenance acyclic). */

export const checkoutKey = (ns: string, repo: string, commit: string) => `${ns}/${repo}/${commit}`

export type Progress = {
  phase: 'resolving' | 'listing' | 'downloading' | 'linking' | 'publishing'
  files_done: number
  files_total: number
  bytes_done: number
  bytes_total: number
}

export type ManifestFile = { size: number; sha256: string; oxen_hash: string }

/** In-memory manifest. Maps (not objects) so a file named `__proto__` is harmless. */
export type Manifest = {
  commit: string
  rootHash: string
  files: Map<string, ManifestFile>
  /** directory path ('' = root) → Oxen directory hash */
  dirs: Map<string, string>
}

export type CheckoutMeta = {
  commit: string
  namespace: string
  repo: string
  created_at: string
  last_used_at: string
  built_from: string[]
  files: number
  bytes: number
  new_bytes: number
  downloaded_files: number
  linked_files: number
  pruned_dirs: number
  skipped: { oxen: number; unsupported: number }
  oxen_listing_hash: string
  oxen_size: number | null
  build_ms: number
}

