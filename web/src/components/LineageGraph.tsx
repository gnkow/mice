import { useNavigate } from 'react-router-dom'
import type { FileVersion, LineageOp } from '../lib/lineage'
import { formatRelativeTime } from '../lib/time'

type Props = {
  operations: LineageOp[]
  namespace: string
  repo: string
  branch: string
  focusPath?: string
}

type GraphNode =
  | {
      id: string
      type: 'version'
      version: FileVersion
      layer: number
      row: number
    }
  | {
      id: string
      type: 'op'
      op: LineageOp
      layer: number
      row: number
    }

type GraphEdge = {
  id: string
  from: string
  to: string
  kind: 'in' | 'out'
}

/**
 * Identity keys for a file version.
 * - Complete refs (hash+commit) stay distinct per commit so restore of the same
 *   bytes is a separate node from the original upload.
 * - Commit-only refs alias onto the complete ref with that commit.
 * - Hash-only refs alias onto a complete ref only when exactly one commit
 *   shares that path+hash (avoids duplicate nodes from sparse refs).
 */
function versionAliasKeys(
  v: Pick<FileVersion, 'path' | 'contentHash' | 'commitId'>,
): string[] {
  if (v.contentHash && v.commitId) {
    return [
      `${v.path}\0hc:${v.contentHash}:${v.commitId}`,
      `${v.path}\0c:${v.commitId}`,
    ]
  }
  if (v.contentHash) return [`${v.path}\0h:${v.contentHash}`]
  if (v.commitId) return [`${v.path}\0c:${v.commitId}`]
  return [`${v.path}\0_`]
}

function mergeVersionMeta(a: FileVersion, b: FileVersion): FileVersion {
  return {
    namespace: a.namespace || b.namespace,
    repo: a.repo || b.repo,
    path: a.path || b.path,
    contentHash: a.contentHash ?? b.contentHash,
    commitId: a.commitId ?? b.commitId,
  }
}

function buildVersionIdentity(versions: FileVersion[]): {
  idOf: (v: FileVersion) => string
  meta: Map<string, FileVersion>
} {
  const parent = new Map<string, string>()

  function find(x: string): string {
    let cur = x
    while (parent.get(cur) !== cur) {
      const p = parent.get(cur)
      if (p == null) {
        parent.set(cur, cur)
        return cur
      }
      cur = p
    }
    return cur
  }

  function union(a: string, b: string) {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Prefer complete hash+commit roots.
    if (ra.includes('\0hc:') && !rb.includes('\0hc:')) parent.set(rb, ra)
    else if (rb.includes('\0hc:') && !ra.includes('\0hc:')) parent.set(ra, rb)
    else if (ra < rb) parent.set(rb, ra)
    else parent.set(ra, rb)
  }

  for (const v of versions) {
    const keys = versionAliasKeys(v)
    for (const k of keys) {
      if (!parent.has(k)) parent.set(k, k)
    }
    for (let i = 1; i < keys.length; i++) union(keys[0]!, keys[i]!)
  }

  // Hash-only refs → unique complete (path+hash+commit) when unambiguous.
  const completesByHash = new Map<string, Set<string>>()
  for (const v of versions) {
    if (!v.contentHash || !v.commitId) continue
    const hk = `${v.path}\0h:${v.contentHash}`
    const root = find(`${v.path}\0hc:${v.contentHash}:${v.commitId}`)
    const set = completesByHash.get(hk) ?? new Set()
    set.add(root)
    completesByHash.set(hk, set)
  }
  for (const v of versions) {
    if (!v.contentHash || v.commitId) continue
    const hk = `${v.path}\0h:${v.contentHash}`
    if (!parent.has(hk)) parent.set(hk, hk)
    const candidates = [...(completesByHash.get(hk) ?? [])]
    if (candidates.length === 1) union(hk, candidates[0]!)
  }

  const meta = new Map<string, FileVersion>()
  for (const v of versions) {
    const id = `v:${find(versionAliasKeys(v)[0]!)}`
    const prev = meta.get(id)
    meta.set(id, prev ? mergeVersionMeta(prev, v) : v)
  }

  return {
    idOf: (v) => `v:${find(versionAliasKeys(v)[0]!)}`,
    meta,
  }
}

function shortName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || path || '(root)'
}

function buildGraph(operations: LineageOp[]): {
  nodes: GraphNode[]
  edges: GraphEdge[]
} {
  const sorted = [...operations].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  )

  const allVersions: FileVersion[] = []
  for (const op of sorted) {
    allVersions.push(...op.inputs, ...op.outputs)
  }
  const { idOf, meta: versionMeta } = buildVersionIdentity(allVersions)

  const versionIds = new Set<string>(versionMeta.keys())
  const edges: GraphEdge[] = []
  const opNodes: Omit<Extract<GraphNode, { type: 'op' }>, 'layer' | 'row'>[] =
    []
  const edgeKeys = new Set<string>()

  for (const op of sorted) {
    const oid = `op:${op.id}`
    opNodes.push({ id: oid, type: 'op', op })
    for (const v of op.inputs) {
      const vid = idOf(v)
      const ek = `${vid}->${oid}`
      if (!edgeKeys.has(ek)) {
        edgeKeys.add(ek)
        edges.push({ id: ek, from: vid, to: oid, kind: 'in' })
      }
    }
    for (const v of op.outputs) {
      const vid = idOf(v)
      const ek = `${oid}->${vid}`
      if (!edgeKeys.has(ek)) {
        edgeKeys.add(ek)
        edges.push({ id: ek, from: oid, to: vid, kind: 'out' })
      }
    }
  }

  // Layer assignment: longest-path from sources (versions with no inbound).
  const inbound = new Map<string, string[]>()
  const outbound = new Map<string, string[]>()
  for (const id of [...versionIds, ...opNodes.map((n) => n.id)]) {
    inbound.set(id, [])
    outbound.set(id, [])
  }
  for (const e of edges) {
    inbound.get(e.to)?.push(e.from)
    outbound.get(e.from)?.push(e.to)
  }

  const layerOf = new Map<string, number>()
  const visiting = new Set<string>()

  function layer(id: string): number {
    const cached = layerOf.get(id)
    if (cached != null) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const preds = inbound.get(id) ?? []
    const l =
      preds.length === 0 ? 0 : Math.max(...preds.map((p) => layer(p))) + 1
    visiting.delete(id)
    layerOf.set(id, l)
    return l
  }

  for (const id of versionIds) layer(id)
  for (const n of opNodes) layer(n.id)

  const byLayer = new Map<number, string[]>()
  for (const [id, l] of layerOf) {
    const list = byLayer.get(l) ?? []
    list.push(id)
    byLayer.set(l, list)
  }

  const nodes: GraphNode[] = []
  for (const [l, ids] of [...byLayer.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort()
    ids.forEach((id, row) => {
      if (id.startsWith('op:')) {
        const op = opNodes.find((n) => n.id === id)!
        nodes.push({ ...op, layer: l, row })
      } else {
        nodes.push({
          id,
          type: 'version',
          version: versionMeta.get(id)!,
          layer: l,
          row,
        })
      }
    })
  }

  return { nodes, edges }
}

const COL_W = 168
const ROW_H = 88
const NODE_W = 132
const NODE_H_V = 52
const NODE_H_OP = 40
const PAD_X = 24
const PAD_Y = 20

export function LineageGraph({
  operations,
  namespace,
  repo,
  branch,
  focusPath,
}: Props) {
  const navigate = useNavigate()
  const { nodes, edges } = buildGraph(operations)
  if (nodes.length === 0) return null

  const maxLayer = Math.max(...nodes.map((n) => n.layer), 0)
  const maxRow = Math.max(...nodes.map((n) => n.row), 0)
  const width = PAD_X * 2 + (maxLayer + 1) * COL_W
  const height = PAD_Y * 2 + (maxRow + 1) * ROW_H

  const pos = new Map<string, { x: number; y: number; h: number }>()
  for (const n of nodes) {
    const h = n.type === 'op' ? NODE_H_OP : NODE_H_V
    pos.set(n.id, {
      x: PAD_X + n.layer * COL_W + (COL_W - NODE_W) / 2,
      y: PAD_Y + n.row * ROW_H + (ROW_H - h) / 2,
      h,
    })
  }

  function goToVersion(v: FileVersion) {
    navigate(
      `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}/blob/${encodeURIComponent(branch)}/${v.path}`,
    )
  }

  return (
    <div className="lineage-graph-wrap" data-testid="lineage-graph">
      <svg
        className="lineage-graph"
        viewBox={`0 0 ${width} ${height}`}
        width={Math.min(width, 960)}
        height={height}
        role="img"
        aria-label="File lineage graph"
      >
        <defs>
          <marker
            id="lineage-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        {edges.map((e) => {
          const a = pos.get(e.from)
          const b = pos.get(e.to)
          if (!a || !b) return null
          const x1 = a.x + NODE_W
          const y1 = a.y + a.h / 2
          const x2 = b.x
          const y2 = b.y + b.h / 2
          const mx = (x1 + x2) / 2
          return (
            <path
              key={e.id}
              className="lineage-edge-path"
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              markerEnd="url(#lineage-arrow)"
            />
          )
        })}

        {nodes.map((n) => {
          const p = pos.get(n.id)!
          if (n.type === 'op') {
            const low = n.op.confidence === 'low'
            const derived = n.op.source === 'derived'
            return (
              <g
                key={n.id}
                transform={`translate(${p.x}, ${p.y})`}
                data-lineage-id={n.op.id}
              >
                <rect
                  className={`lineage-node-op lineage-${n.op.kind}${low ? ' low' : ''}`}
                  width={NODE_W}
                  height={NODE_H_OP}
                  rx={NODE_H_OP / 2}
                />
                <text
                  className="lineage-node-op-label"
                  x={NODE_W / 2}
                  y={NODE_H_OP / 2 + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {n.op.kind}
                  {derived ? '*' : ''}
                </text>
                <title>
                  {`${n.op.kind} · ${n.op.source}${low ? ' · low confidence' : ''} · ${new Date(n.op.ts).toLocaleString()}`}
                </title>
              </g>
            )
          }

          const focused =
            focusPath != null && n.version.path === focusPath
          const hash = n.version.contentHash?.slice(0, 8) ?? '—'
          return (
            <g
              key={n.id}
              transform={`translate(${p.x}, ${p.y})`}
              className="lineage-node-link"
              role="link"
              tabIndex={0}
              onClick={() => goToVersion(n.version)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  goToVersion(n.version)
                }
              }}
            >
              <rect
                className={`lineage-node-version${focused ? ' focus' : ''}`}
                width={NODE_W}
                height={NODE_H_V}
                rx={8}
              />
              <text
                className="lineage-node-path"
                x={NODE_W / 2}
                y={20}
                textAnchor="middle"
              >
                {shortName(n.version.path).slice(0, 18)}
              </text>
              <text
                className="lineage-node-hash"
                x={NODE_W / 2}
                y={38}
                textAnchor="middle"
              >
                {hash}
              </text>
              <title>
                {`${n.version.path}${n.version.contentHash ? ` @ ${n.version.contentHash}` : ''}${n.version.commitId ? ` (${n.version.commitId.slice(0, 8)})` : ''}`}
              </title>
            </g>
          )
        })}
      </svg>
      <p className="muted small lineage-graph-legend">
        Rectangles are file versions; pills are operations. * = derived from
        history.
        {operations[0] && (
          <>
            {' '}
            Newest op{' '}
            {formatRelativeTime(
              [...operations].sort((a, b) => (a.ts < b.ts ? 1 : -1))[0]!.ts,
            )}
            .
          </>
        )}
      </p>
    </div>
  )
}
