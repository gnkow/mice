/** Minimal ustar reader for oxen QUERY /versions gzip tarballs. */

async function gunzip(data: ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Gzip decompression is not supported in this browser')
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

function readOctal(bytes: Uint8Array, start: number, len: number): number {
  let s = ''
  for (let i = start; i < start + len; i++) {
    const c = bytes[i]
    if (c === 0) break
    s += String.fromCharCode(c)
  }
  s = s.trim()
  if (!s) return 0
  return parseInt(s, 8)
}

function readCString(bytes: Uint8Array, start: number, len: number): string {
  let end = start
  while (end < start + len && bytes[end] !== 0) end += 1
  return new TextDecoder().decode(bytes.subarray(start, end))
}

/** Extract file members from a gzip-compressed ustar archive. */
export async function extractGzipTar(
  gzipData: ArrayBuffer,
): Promise<Map<string, Uint8Array>> {
  const data = await gunzip(gzipData)
  const out = new Map<string, Uint8Array>()
  let offset = 0

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512)
    offset += 512
    if (header.every((b) => b === 0)) break

    const name = readCString(header, 0, 100)
    const size = readOctal(header, 124, 12)
    const typeflag = header[156]
    const prefix = readCString(header, 345, 155)
    const fullName = prefix ? `${prefix}/${name}` : name

    const content = data.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512

    // '0' or '\0' = regular file
    if (fullName && (typeflag === 0 || typeflag === 48)) {
      out.set(fullName, content.slice())
    }
  }

  return out
}
