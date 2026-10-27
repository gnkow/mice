#!/usr/bin/env node
/**
 * CLI tool for seal key rotation (Ticket 17)
 * 
 * Usage:
 *   npx tsx src/authentication/session/rotateSealKey.ts normal
 *   npx tsx src/authentication/session/rotateSealKey.ts emergency "Key compromise detected"
 */

import { openMainDatabase, closeMainDatabase } from '../../db/database.js'
import { normalRotation, emergencyRotation, getCurrentSealKey, getAllSealKeys } from './sealKeys.js'

const USAGE = `
Usage: npx tsx src/authentication/session/rotateSealKey.ts <command> [reason]

Commands:
  normal              - Normal rotation (30-day schedule, 7-day overlap)
  emergency [reason]  - Emergency rotation (immediate revocation, 8-hour grace)
  list                - List all seal keys
  current             - Show current primary seal key

Examples:
  npx tsx src/authentication/session/rotateSealKey.ts normal
  npx tsx src/authentication/session/rotateSealKey.ts emergency "Key compromise detected"
  npx tsx src/authentication/session/rotateSealKey.ts list
`.trim()

async function main() {
  const command = process.argv[2]
  
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE)
    process.exit(0)
  }
  
  await openMainDatabase()
  
  try {
    switch (command) {
      case 'normal': {
        console.log('Performing normal seal key rotation...')
        const newKey = await normalRotation()
        console.log('✓ Normal rotation completed')
        console.log(`  New key ID: ${newKey.id}`)
        console.log(`  Valid from: ${new Date(newKey.validFrom * 1000).toISOString()}`)
        console.log(`  Type: ${newKey.rotationType}`)
        break
      }
      
      case 'emergency': {
        const reason = process.argv.slice(3).join(' ') || 'Emergency rotation via CLI'
        console.log('⚠️  EMERGENCY ROTATION')
        console.log(`   Reason: ${reason}`)
        console.log()
        
        const { oldKey, newKey } = await emergencyRotation()
        console.log('✓ Emergency rotation completed')
        console.log()
        console.log('Old key (revoked):')
        console.log(`  ID: ${oldKey.id}`)
        console.log(`  Revoked at: ${new Date(oldKey.revokedAt! * 1000).toISOString()}`)
        console.log(`  Grace period until: ${new Date(oldKey.validUntil! * 1000).toISOString()}`)
        console.log()
        console.log('New key (active):')
        console.log(`  ID: ${newKey.id}`)
        console.log(`  Valid from: ${new Date(newKey.validFrom * 1000).toISOString()}`)
        console.log(`  Type: ${newKey.rotationType}`)
        break
      }
      
      case 'list': {
        const keys = await getAllSealKeys()
        const now = Math.floor(Date.now() / 1000)
        
        console.log(`Seal Keys (${keys.length} total):\n`)
        
        for (const key of keys) {
          const isCurrent = key.validUntil === null && key.revokedAt === null
          const isRevoked = key.revokedAt !== null
          const isExpired = key.validUntil !== null && key.validUntil < now
          
          let status = '  '
          if (isCurrent) status = '✓ '
          if (isRevoked) status = '✗ '
          if (isExpired) status = '⊗ '
          
          console.log(`${status}${key.id}`)
          console.log(`   Valid from: ${new Date(key.validFrom * 1000).toISOString()}`)
          if (key.validUntil) {
            console.log(`   Valid until: ${new Date(key.validUntil * 1000).toISOString()}`)
          }
          if (key.revokedAt) {
            console.log(`   Revoked at: ${new Date(key.revokedAt * 1000).toISOString()}`)
          }
          console.log(`   Type: ${key.rotationType}`)
          console.log()
        }
        
        console.log('Legend: ✓ = current, ✗ = revoked, ⊗ = expired')
        break
      }
      
      case 'current': {
        const current = await getCurrentSealKey()
        if (!current) {
          console.log('No current seal key found')
          process.exit(1)
        }
        
        console.log('Current Primary Seal Key:\n')
        console.log(`  ID: ${current.id}`)
        console.log(`  Valid from: ${new Date(current.validFrom * 1000).toISOString()}`)
        console.log(`  Type: ${current.rotationType}`)
        console.log(`  Created: ${current.createdAt.toISOString()}`)
        break
      }
      
      default:
        console.error(`Unknown command: ${command}`)
        console.log()
        console.log(USAGE)
        process.exit(1)
    }
  } finally {
    await closeMainDatabase()
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
