import { useEffect, useId, useMemo, useState } from 'react'
import type { TransferAccessDiff, TransferAccessSeat } from '../lib/authzApi'
import type { PrincipalProfiles } from '../lib/commitEmail'
import { toAuthorKey } from '../lib/userRef'
import { usePrincipalProfiles } from './CommitEmail'
import { GroupPrincipalLabel } from './GroupPrincipalLabel'
import { UserRef } from './UserRef'

type InheritSeat = TransferAccessDiff['newlyInheriting'][number]
type DiffSeat = TransferAccessSeat | InheritSeat
type OutcomeTab = 'kept' | 'dropped' | 'inheriting'

const PAGE_SIZE = 8

function seatAuthors(diff: TransferAccessDiff): string[] {
  const keys: string[] = []
  for (const list of [diff.kept, diff.dropped] as TransferAccessSeat[][]) {
    for (const s of list) {
      if (s.kind === 'user') keys.push(toAuthorKey(s.key))
    }
  }
  for (const s of diff.newlyInheriting) {
    if (s.kind === 'user') keys.push(toAuthorKey(s.key))
  }
  return [...new Set(keys)]
}

function bySeat(
  seats: TransferAccessSeat[],
  seat: TransferAccessSeat['seat'],
): TransferAccessSeat[] {
  return seats.filter((s) => s.seat === seat)
}

/** Prefer the outcome with the most actionable seats for the initial tab. */
export function defaultTransferDiffTab(diff: TransferAccessDiff): OutcomeTab {
  if (diff.dropped.length > 0) return 'dropped'
  if (diff.newlyInheriting.length > 0) return 'inheriting'
  return 'kept'
}

export function transferDiffTabCounts(diff: TransferAccessDiff): Record<OutcomeTab, number> {
  return {
    kept: diff.kept.length,
    dropped: diff.dropped.length,
    inheriting: diff.newlyInheriting.length,
  }
}

function SeatLabel({
  seat,
  profiles,
}: {
  seat: DiffSeat
  profiles: PrincipalProfiles
}) {
  if (seat.kind === 'group') {
    return <GroupPrincipalLabel group={seat.key} />
  }
  return <UserRef author={toAuthorKey(seat.key)} profiles={profiles} />
}

function SeatItems({
  items,
  empty,
  profiles,
  showRole,
  showVia,
}: {
  items: DiffSeat[]
  empty: string
  profiles: PrincipalProfiles
  showRole?: boolean
  showVia?: boolean
}) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages - 1)
  const visible =
    items.length <= PAGE_SIZE
      ? items
      : items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  if (items.length === 0) {
    return <p className="muted small">{empty}</p>
  }

  return (
    <div className="transfer-diff-items">
      <ul className="transfer-diff-list">
        {visible.map((s) => {
          const role =
            showRole && 'role' in s && s.role ? s.role : null
          const via =
            showVia && 'viaBasePermission' in s
              ? `base ${s.viaBasePermission}`
              : null
          const meta = role ?? via
          return (
            <li
              key={`${s.kind}:${s.key}:${'seat' in s ? s.seat : 'inherit'}`}
            >
              <span className="transfer-diff-principal">
                <SeatLabel seat={s} profiles={profiles} />
              </span>
              {meta ? (
                <span className="transfer-diff-meta muted small">{meta}</span>
              ) : null}
            </li>
          )
        })}
      </ul>
      {items.length > PAGE_SIZE ? (
        <div className="transfer-diff-pager" role="navigation" aria-label="List pages">
          <button
            type="button"
            className="btn ghost small"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <span className="muted small transfer-diff-pager-status">
            {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            className="btn ghost small"
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SeatGroup({
  title,
  items,
  empty,
  profiles,
  showRole,
}: {
  title: string
  items: TransferAccessSeat[]
  empty: string
  profiles: PrincipalProfiles
  showRole?: boolean
}) {
  return (
    <div className="transfer-diff-group">
      <h4 className="transfer-diff-group-title">{title}</h4>
      <SeatItems
        items={items}
        empty={empty}
        profiles={profiles}
        showRole={showRole}
      />
    </div>
  )
}

function OutcomePanel({
  seats,
  emptyCollaborators,
  emptyApprovers,
  profiles,
}: {
  seats: TransferAccessSeat[]
  emptyCollaborators: string
  emptyApprovers: string
  profiles: PrincipalProfiles
}) {
  return (
    <div className="transfer-diff-groups">
      <SeatGroup
        title="Collaborators"
        items={bySeat(seats, 'collaborator')}
        empty={emptyCollaborators}
        profiles={profiles}
        showRole
      />
      <SeatGroup
        title="Approvers"
        items={bySeat(seats, 'approver')}
        empty={emptyApprovers}
        profiles={profiles}
      />
    </div>
  )
}

/** Access-change preview for repository transfer — tabbed kept / dropped / inheriting. */
export function TransferAccessDiffView({
  diff,
  loading,
}: {
  diff: TransferAccessDiff | null
  loading?: boolean
}) {
  const tabsId = useId()
  const authors = useMemo(() => (diff ? seatAuthors(diff) : []), [diff])
  const profiles = usePrincipalProfiles(authors)
  const [tab, setTab] = useState<OutcomeTab | null>(null)

  useEffect(() => {
    setTab(null)
  }, [diff])

  if (loading) {
    return (
      <p className="muted small" role="status" aria-live="polite">
        Loading access changes…
      </p>
    )
  }
  if (!diff) return null

  const active = tab ?? defaultTransferDiffTab(diff)
  const tabs: Array<{ id: OutcomeTab; label: string; count: number; warn?: boolean }> = [
    { id: 'kept', label: 'Kept', count: diff.kept.length },
    { id: 'dropped', label: 'Dropped', count: diff.dropped.length },
    {
      id: 'inheriting',
      label: 'Inheriting',
      count: diff.newlyInheriting.length,
      warn: true,
    },
  ]

  return (
    <div className="transfer-diff" aria-label="Access changes">
      <div className="tab-bar" role="tablist" aria-label="Access change outcomes">
        {tabs.map((t) => {
          const selected = active === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              className={[
                selected ? 'active' : undefined,
                t.warn ? 'transfer-diff-tab-warn' : undefined,
              ]
                .filter(Boolean)
                .join(' ') || undefined}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              <span className="transfer-diff-tab-count">{t.count}</span>
            </button>
          )
        })}
      </div>

      <div
        className="transfer-diff-panel"
        role="tabpanel"
        id={`${tabsId}-panel-${active}`}
        aria-labelledby={`${tabsId}-tab-${active}`}
      >
        {active === 'kept' ? (
          <OutcomePanel
            seats={diff.kept}
            emptyCollaborators="None kept."
            emptyApprovers="None kept."
            profiles={profiles}
          />
        ) : null}
        {active === 'dropped' ? (
          <OutcomePanel
            seats={diff.dropped}
            emptyCollaborators="None dropped."
            emptyApprovers="None dropped."
            profiles={profiles}
          />
        ) : null}
        {active === 'inheriting' ? (
          <SeatItems
            items={diff.newlyInheriting}
            empty="No additional access via base permission."
            profiles={profiles}
            showVia
          />
        ) : null}
      </div>
    </div>
  )
}
