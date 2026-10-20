import type { Server as HttpServer } from 'node:http'
import { createRequire } from 'node:module'
import { env } from './env.js'

/**
 * Attach guacamole-lite WebSocket gateway to the auth HTTP server.
 * Browser uses guacamole-common-js (or our canvas client) with an encrypted token.
 *
 * When SESSIONS_CONNECT_BACKEND=rustguac, this is skipped (rustguac owns WS).
 */
export function attachSessionsGuacGateway(server: HttpServer): void {
  if (!env.sessionsEnabled) return
  if (env.sessionsConnectBackend === 'rustguac') {
    console.log('[sessions] connect backend=rustguac; skipping guacamole-lite')
    return
  }
  try {
    const require = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const GuacamoleLite = require('guacamole-lite') as new (
      wsOpts: object,
      guacdOpts: object,
      clientOpts: object,
    ) => unknown
    new GuacamoleLite(
      {
        server,
        path: env.sessionsGuacWsPath,
      },
      {
        host: env.sessionsGuacdHost,
        port: env.sessionsGuacdPort,
      },
      {
        crypt: {
          cypher: 'AES-256-CBC',
          key: env.sessionsGuacCryptKey.slice(0, 32).padEnd(32, '0'),
        },
        log: {
          level: 'ERRORS',
        },
      },
    )
    console.log(
      `[sessions] guacamole-lite on ${env.sessionsGuacWsPath} → ${env.sessionsGuacdHost}:${env.sessionsGuacdPort}`,
    )
  } catch (err) {
    console.warn(
      '[sessions] guacamole-lite not available; Connect WS disabled:',
      err instanceof Error ? err.message : err,
    )
  }
}
