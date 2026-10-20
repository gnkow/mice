import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { env } from './env.js'
import type { DesktopSession } from './sessionsTypes.js'

export type ConnectPayload = {
  client_url: string
  ticket: string
  expires_in: number
  backend: 'guacamole_lite' | 'rustguac'
  /** Guacamole-lite encrypted token (when backend=guacamole_lite) */
  token?: string
  ws_path?: string
}

/**
 * guacamole-lite compatible AES-256-CBC token.
 * Token = base64(JSON({ iv: base64, value: base64 ciphertext })).
 * @see https://github.com/vadimpronin/guacamole-lite
 */
export function encryptGuacamoleLiteToken(
  value: object,
  keyMaterial: string,
): string {
  // guacamole-lite uses Buffer.from(SECRET_KEY) as utf8 — 32-char key string
  const keyStr = keyMaterial.slice(0, 32).padEnd(32, '0')
  const key = Buffer.from(keyStr, 'utf8')
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'base64')
  encrypted += cipher.final('base64')
  return Buffer.from(
    JSON.stringify({
      iv: iv.toString('base64'),
      value: encrypted,
    }),
    'utf8',
  ).toString('base64')
}

function rdpConnectionToken(session: DesktopSession): string {
  const host = session.endpoints?.rdp_host
  const port = session.endpoints?.rdp_port ?? 3389
  if (!host) throw new Error('session has no RDP endpoint')
  // xrdp + Guacamole FreeRDP: GFX off, no reconnect-resize, modest color depth.
  // (24bpp + GFX often yields a blank/unusable desktop in the browser.)
  const tokenObject = {
    connection: {
      type: 'rdp',
      settings: {
        hostname: host,
        port: String(port),
        username: session.guest_user,
        password: session.guest_password,
        width: '1280',
        height: '800',
        dpi: '96',
        'color-depth': '16',
        'ignore-cert': 'true',
        'disable-gfx': 'true',
        cursor: 'local',
        'enable-wallpaper': 'false',
        'enable-theming': 'false',
        'enable-font-smoothing': 'false',
        'enable-full-window-drag': 'false',
        'enable-desktop-composition': 'false',
        'enable-menu-animations': 'false',
        'disable-audio': 'true',
        'disable-glyph-caching': 'false',
        'disable-offscreen-caching': 'false',
        'disable-bitmap-caching': 'false',
        security: 'any',
        ...(session.recording && env.sessionsRecording
          ? { 'create-recording-path': `/tmp/mice-sess-${session.id}` }
          : {}),
      },
    },
  }
  return encryptGuacamoleLiteToken(tokenObject, env.sessionsGuacCryptKey)
}

/** Mint a short-lived opaque ticket id (BFF-held; maps to session for WS auth). */
const tickets = new Map<
  string,
  { sessionId: string; expiresAt: number; token: string }
>()

function mintGuacamoleLiteTicket(session: DesktopSession): ConnectPayload {
  const token = rdpConnectionToken(session)
  const ticket = `wst_${randomBytes(16).toString('hex')}`
  const expiresIn = 30
  tickets.set(ticket, {
    sessionId: session.id,
    expiresAt: Date.now() + expiresIn * 1000,
    token,
  })
  const base = env.sessionsPublicConnectOrigin || env.publicWebOrigin
  const clientUrl = `${base}/sessions/${encodeURIComponent(session.id)}/desktop?ticket=${encodeURIComponent(ticket)}`
  return {
    client_url: clientUrl,
    ticket,
    expires_in: expiresIn,
    backend: 'guacamole_lite',
    token,
    ws_path: env.sessionsGuacWsPath,
  }
}

export function consumeConnectTicket(
  ticket: string,
): { sessionId: string; token: string } | null {
  const row = tickets.get(ticket)
  if (!row) return null
  tickets.delete(ticket)
  if (Date.now() > row.expiresAt) return null
  return { sessionId: row.sessionId, token: row.token }
}

export function peekConnectTicket(
  ticket: string,
): { sessionId: string; token: string } | null {
  const row = tickets.get(ticket)
  if (!row) return null
  if (Date.now() > row.expiresAt) {
    tickets.delete(ticket)
    return null
  }
  return { sessionId: row.sessionId, token: row.token }
}

async function mintRustguacTicket(
  session: DesktopSession,
): Promise<ConnectPayload> {
  const host = session.endpoints?.rdp_host
  const port = session.endpoints?.rdp_port ?? 3389
  if (!host) throw new Error('session has no RDP endpoint')
  const base = env.sessionsRustguacUrl.replace(/\/$/, '')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${env.sessionsRustguacApiKey}`,
  }
  const create = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      protocol: 'rdp',
      hostname: host,
      port,
      username: session.guest_user,
      password: session.guest_password,
      ignore_cert: true,
    }),
  })
  if (!create.ok) {
    const text = await create.text()
    throw new Error(`rustguac create failed (${create.status}): ${text}`)
  }
  const created = (await create.json()) as {
    id?: string
    client_url?: string
  }
  const ticketRes = await fetch(`${base}/api/ws-ticket`, {
    method: 'POST',
    headers,
  })
  if (!ticketRes.ok) {
    throw new Error(`rustguac ws-ticket failed (${ticketRes.status})`)
  }
  const ticketBody = (await ticketRes.json()) as { ticket?: string }
  const ticket = ticketBody.ticket || ''
  const clientUrl = created.client_url
    ? `${created.client_url}${created.client_url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(ticket)}`
    : `${base}/client/${created.id}?ticket=${encodeURIComponent(ticket)}`
  return {
    client_url: clientUrl,
    ticket,
    expires_in: 30,
    backend: 'rustguac',
  }
}

export async function mintConnectPayload(
  session: DesktopSession,
): Promise<ConnectPayload> {
  if (env.sessionsConnectBackend === 'rustguac' && env.sessionsRustguacUrl) {
    return mintRustguacTicket(session)
  }
  return mintGuacamoleLiteTicket(session)
}

export function defaultGuacCryptKeyFromSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}
