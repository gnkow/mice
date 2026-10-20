import { createInterface } from 'node:readline'

/**
 * Require interactive confirmation for destructive job operations.
 * Pass `--yes` / `-y` or set MICE_YES=1 to skip.
 * Non-TTY without --yes refuses (fail closed).
 *
 * @param {string} message
 * @param {{ yes?: boolean, y?: boolean }} flags
 */
export async function confirmOrExit(message, flags = {}) {
  if (flags.yes || flags.y || process.env.MICE_YES === '1') return

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      'Refusing destructive action without a TTY. Re-run with --yes if you intend this.',
    )
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((resolve) => {
    rl.question(`${message}\nType 'yes' to continue: `, (line) => {
      rl.close()
      resolve(String(line || '').trim().toLowerCase())
    })
  })
  if (answer !== 'yes') {
    console.error('Aborted.')
    process.exit(1)
  }
}
