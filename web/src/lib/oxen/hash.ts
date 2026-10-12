import { createXXHash128 } from 'hash-wasm'

const CHUNK = 4 * 1024 * 1024

/** XXH3-128 hex digest with leading zeros stripped (oxen version_id format). */
export async function xxh128File(file: File): Promise<string> {
  const hasher = await createXXHash128()
  hasher.init()
  let offset = 0
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK)
    const buf = new Uint8Array(await slice.arrayBuffer())
    hasher.update(buf)
    offset += buf.length
  }
  return hasher.digest('hex').replace(/^0+/, '') || '0'
}
