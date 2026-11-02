/** The name on a signature, as of the day it was signed. A different current name is shown beside it. */
export function shownSignature(signature: { name: string; signedAt: number }, currentName?: string): string {
  const date = new Date(signature.signedAt).toISOString().slice(0, 10)
  const line = `Signed by: ${signature.name} (${date})`
  if (currentName && currentName !== signature.name) return `${line} (currently: ${currentName})`
  return line
}
