import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { OxenError, type OxenClient, type OxenEntry, type OxenListing } from './oxenClient.js'

export type FakeTree = Record<string, string>

const h = (s: string) => createHash('md5').update(s).digest('hex').slice(0, 31)

/** In-memory Oxen: commits map to `{path: content}`; dir hashes derive from subtree content like Oxen's. */
export class FakeOxen implements OxenClient {
  commits = new Map<string, FakeTree>()
  branches = new Map<string, string>()
  downloads: string[] = []
  listings: string[] = []
  /** Throw a retryable error once this many downloads have happened. */
  failAfterDownloads: number | null = null
  /** Extra synthetic entries returned at the root listing (hostile names). */
  rawRootEntries = new Map<string, OxenEntry[]>()
  fileDelayMs = 0

  commit(id: string, tree: FakeTree, branch?: string): string {
    this.commits.set(id, tree)
    if (branch) this.branches.set(branch, id)
    return id
  }

  async resolveCommit(_ns: string, _repo: string, ref: string): Promise<string> {
    if (this.commits.has(ref)) return ref
    const c = this.branches.get(ref)
    if (!c) throw new OxenError(`revision ${ref} not found`, 404, false)
    return c
  }

  private tree(commit: string): FakeTree {
    const t = this.commits.get(commit)
    if (!t) throw new OxenError(`commit ${commit} not found`, 404, false)
    return t
  }

  async listDir(_ns: string, _repo: string, commit: string, path: string): Promise<OxenListing> {
    this.listings.push(path)
    const tree = this.tree(commit)
    const prefix = path ? `${path}/` : ''
    const children = new Map<string, OxenEntry>()
    for (const [p, content] of Object.entries(tree)) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash < 0) children.set(rest, { name: rest, isDir: false, hash: h(content), size: Buffer.byteLength(content), dataType: 'text' })
      else {
        const name = rest.slice(0, slash)
        if (!children.has(name)) children.set(name, { name, isDir: true, hash: this.dirHash(tree, prefix + name), size: 0, dataType: 'dir' })
      }
    }
    for (const e of this.rawRootEntries.get(commit) ?? []) if (!path) children.set(e.name, e)
    return { hash: path ? this.dirHash(tree, path) : this.dirHash(tree, ''), size: null, entries: [...children.values()] }
  }

  private dirHash(tree: FakeTree, dir: string): string {
    const prefix = dir ? `${dir}/` : ''
    const parts = Object.entries(tree)
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, c]) => `${p.slice(prefix.length)}:${h(c)}`)
      .sort()
    return h(`dir:${parts.join('|')}`)
  }

  async openFile(_ns: string, _repo: string, commit: string, path: string): Promise<Readable> {
    if (this.failAfterDownloads !== null && this.downloads.length >= this.failAfterDownloads) {
      throw new OxenError('simulated crash', 503, true)
    }
    this.downloads.push(path)
    if (this.fileDelayMs) await new Promise((r) => setTimeout(r, this.fileDelayMs))
    const c = this.tree(commit)[path]
    if (c === undefined) throw new OxenError(`file ${path} not found`, 404, false)
    return Readable.from([Buffer.from(c)])
  }
}
