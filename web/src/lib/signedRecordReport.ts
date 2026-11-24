export type SignedRecordReportFormat = 'pdf' | 'json'

export function signedRecordReportUrl(
  namespace: string,
  repo: string,
  format: SignedRecordReportFormat = 'pdf',
): string {
  return `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/signed-record-report?format=${format}`
}

/** Download the per-repository signed-record report (GxP #106). */
export async function downloadSignedRecordReport(
  namespace: string,
  repo: string,
  format: SignedRecordReportFormat = 'pdf',
): Promise<string> {
  const accept = format === 'pdf' ? 'application/pdf' : 'application/json'
  const res = await fetch(signedRecordReportUrl(namespace, repo, format), {
    credentials: 'same-origin',
    headers: { Accept: accept },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(
      body.error ??
        (res.status === 403
          ? 'You need read access to this repository to download its signed-record report'
          : `Signed-record report failed (${res.status})`),
    )
  }

  if (format === 'json') {
    const body = await res.json()
    const name = `${repo}-signed-record.json`
    const blob = new Blob([JSON.stringify(body, null, 2)], {
      type: 'application/json',
    })
    triggerDownload(blob, name)
    return name
  }

  const blob = await res.blob()
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    `${repo}-signed-record.pdf`
  triggerDownload(blob, name)
  return name
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
