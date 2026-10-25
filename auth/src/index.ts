import { boot } from './boot.js'

boot().catch((err) => {
  console.error('[mice-auth] startup failed', err)
  process.exit(1)
})
