/** Shared page size for all list pagination in Boxen. */
export const PAGE_SIZE = 12

type Props = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  label?: string
  /** Optional total item count shown next to the page status. */
  total?: number
}

/** Always visible; Previous/Next disable when at the ends. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = 'Pagination',
  total,
}: Props) {
  const status =
    total != null
      ? `${total} · Page ${page} of ${pageCount}`
      : `Page ${page} of ${pageCount}`

  return (
    <nav className="pagination" aria-label={label}>
      <button
        type="button"
        className="btn ghost"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span className="pagination-status muted small">{status}</span>
      <button
        type="button"
        className="btn ghost"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  )
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(1, page), pageCount)
  const start = (safePage - 1) * pageSize
  return {
    page: safePage,
    pageCount,
    items: items.slice(start, start + pageSize),
    total: items.length,
  }
}
