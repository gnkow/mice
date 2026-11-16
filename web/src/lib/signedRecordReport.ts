export function signedRecordReportUrl(namespace: string, repo: string): string {
  return `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/signed-record-report?format=pdf`
}

/** Download the per-repository signed-record report as a PDF (GxP #106). */
export async function downloadSignedRecordReport(namespace: string, repo: string): Promise<string> {
  const res = await fetch(signedRecordReportUrl(namespace, repo), {
    credentials: 'same-origin',
    headers: { Accept: 'application/pdf' },
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
  const blob = await res.blob()
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    `${repo}-signed-record.pdf`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return name
}
