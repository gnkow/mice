import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type PostgresConfig = {
  host: string
  port: number
  user: string
  database: string
  password: string
  options?: string
}

function passwordFrom(src: NodeJS.ProcessEnv): string {
  if (src.POSTGRES_PASSWORD) return src.POSTGRES_PASSWORD
  const candidates = [
    src.POSTGRES_PASSWORD_FILE,
    '/run/secrets/postgres_password',
    resolve(process.cwd(), '.secrets/postgres-password'),
    resolve(process.cwd(), '../.secrets/postgres-password'),
  ].filter((p): p is string => !!p)
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    throw new Error(
      'PostgreSQL password not found: set POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE, or run `make db-secrets`',
    )
  }
  return readFileSync(found, 'utf8').trim()
}

/** Connection settings for the main database; the same shape locally and in containers. */
export function postgresConfig(src: NodeJS.ProcessEnv = process.env): PostgresConfig {
  return {
    host: src.POSTGRES_HOST ?? '127.0.0.1',
    port: Number(src.POSTGRES_PORT ?? 5432),
    user: src.POSTGRES_USER ?? 'mice',
    database: src.POSTGRES_DB ?? 'mice',
    password: passwordFrom(src),
    // Test runs get a throwaway schema inside the same server, so they never touch dev data.
    ...(src.MICE_TEST_SCHEMA ? { options: `-c search_path=${src.MICE_TEST_SCHEMA}` } : {}),
  }
}
