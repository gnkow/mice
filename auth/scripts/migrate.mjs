import {migrateDatabase} from '../src/db/database.js'

migrateDatabase()
  .then(() => console.log('Migration complete'))
  .catch(e => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
