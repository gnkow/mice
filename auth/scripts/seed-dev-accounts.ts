#!/usr/bin/env tsx
/**
 * Development bootstrap script
 * 
 * Seeds the database with initial users and permissions for local development.
 * Ensures each role has at least one account:
 * - mice_admin@mice.com: Instance administrator (full access)
 * - mice_manage@mice.com: Manager with delegated permissions
 * - mice_auditor@mice.com: Auditor role (read-only with MFA)
 * - mice_user@mice.com: Regular user (needs access request approval)
 */

import { writeInstancePermissions } from '../src/authzInstanceStore.js'
import { ensureBootstrapKey } from '../src/authentication/session/sealKeys.js'
import { getDb } from '../src/db/database.js'
import { principals } from '../src/db/schema.js'
import { eq, and } from 'drizzle-orm'

const ADMIN_EMAIL = 'mice_admin@mice.com'
const MANAGER_EMAIL = 'mice_manage@mice.com'
const AUDITOR_EMAIL = 'mice_auditor@mice.com'
const USER_EMAIL = 'mice_user@mice.com'
const NO_ACCESS_EMAIL = 'mice_user_no_access@mice.com'

const ISSUER = 'http://keycloak:8080/realms/mice'

async function ensurePrincipal(email: string, sub: string, name: string) {
  const existing = await getDb()
    .select()
    .from(principals)
    .where(and(
      eq(principals.iss, ISSUER),
      eq(principals.sub, sub)
    ))
    .limit(1)
  
  if (existing.length > 0) {
    console.log(`✓ Principal ${email} already exists`)
    return existing[0].id
  }
  
  const [principal] = await getDb()
    .insert(principals)
    .values({
      iss: ISSUER,
      sub,
      name,
      createdAt: new Date(),
    })
    .returning({ id: principals.id })
  
  console.log(`✓ Created principal ${email}`)
  return principal.id
}

async function ensureManagerPermissions(email: string, sub: string) {
  const managerPerms = [
    'create_namespace',
    'view_audit',
    'view_lineage',
    'manage_own_tokens',
    'cli_device_approve',
    'session_create',
    'session_connect',
  ]
  
  await writeInstancePermissions(
    { iss: ISSUER, sub },
    managerPerms
  )
  
  console.log(`✓ Granted manager permissions to ${email}`)
}

async function main() {
  console.log('🌱 Seeding development database with role accounts...\n')
  
  // Ensure seal key exists
  await ensureBootstrapKey()
  console.log('✓ Seal key initialized\n')
  
  // Create principals (they will be fully created on first login via Keycloak)
  console.log('Setting up role accounts:')
  
  // Admin is granted on login when the verified email is in AUTHZ_BOOTSTRAP_ADMINS.
  // The IdP `sub` is assigned by Keycloak, so this script does not write an admin key.
  await ensurePrincipal(ADMIN_EMAIL, 'mice_admin', 'Admin User')
  console.log(`ℹ ${ADMIN_EMAIL} becomes instance admin on login (AUTHZ_BOOTSTRAP_ADMINS)`)
  
  // Manager - delegated permissions
  await ensurePrincipal(MANAGER_EMAIL, 'mice_manage', 'Manager User')
  await ensureManagerPermissions(MANAGER_EMAIL, 'mice_manage')
  
  // Auditor - will need auditor role assigned by admin after first login
  await ensurePrincipal(AUDITOR_EMAIL, 'mice_auditor', 'Auditor User')
  console.log(`ℹ Auditor ${AUDITOR_EMAIL} needs auditor role assigned by admin after first login`)
  
  // Regular user - will be in pending state until approved
  await ensurePrincipal(USER_EMAIL, 'mice_user', 'Regular User')
  console.log(`ℹ User ${USER_EMAIL} will need access request approval`)
  
  // No access user - no grants at all, purely for testing "no access" state
  await ensurePrincipal(NO_ACCESS_EMAIL, 'mice_user_no_access', 'No Access User')
  console.log(`ℹ User ${NO_ACCESS_EMAIL} has no grants (testing no access state)`)
  
  console.log('\n✅ Development seed complete!')
  console.log('\nDefault accounts:')
  console.log('  Admin:     mice_admin@mice.com           / admin123      (full access)')
  console.log('  Manager:   mice_manage@mice.com          / manage123     (delegated permissions)')
  console.log('  Auditor:   mice_auditor@mice.com         / auditor123    (needs role assignment)')
  console.log('  User:      mice_user@mice.com            / user123       (needs approval)')
  console.log('  No Access: mice_user_no_access@mice.com  / noaccess123   (no grants)')
  console.log('\nNote: Keycloak users are imported from auth/keycloak/realm-mice.json')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
