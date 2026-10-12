export type ConfirmDeleteOptions = {
  /** Short headline, e.g. "Delete directory notes/" */
  title: string
  /** Consequence detail shown in the dialog */
  detail: string
  /** Exact string the user must type (default: DELETE) */
  confirmWord?: string
  /** When false, only Confirm/Cancel (default true) */
  requireTypedConfirm?: boolean
}

type Opener = (options: ConfirmDeleteOptions) => Promise<boolean>

let opener: Opener | null = null

/** Wired by ConfirmProvider in the app shell. */
export function registerConfirmOpener(next: Opener | null) {
  opener = next
}

/**
 * Destructive confirm via in-app modal.
 * By default requires typing a confirmation word; pass `requireTypedConfirm: false`
 * for routine file/dir deletes.
 */
export function confirmDelete(
  options: ConfirmDeleteOptions,
): Promise<boolean> {
  if (!opener) {
    console.error('confirmDelete: ConfirmProvider is not mounted')
    return Promise.resolve(false)
  }
  return opener(options)
}
