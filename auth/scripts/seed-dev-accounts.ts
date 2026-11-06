#!/usr/bin/env tsx
/**
 * Development seed: one Keycloak account per formal RBAC role, plus a pending user,
 * and one sample namespace + repository for local UI testing.
 *
 * | Email                     | Password     | Role     |
 * |---------------------------|--------------|----------|
 * | mice_admin@mice.com       | admin123     | admin (AUTHZ_BOOTSTRAP_ADMINS on login) |
 * | mice_manager@mice.com     | manage123    | manager  |
 * | mice_auditor@mice.com     | auditor123   | auditor  |
 * | mice_user@mice.com        | user123      | user     |
 * | mice_external@mice.com    | external123  | external |
 * | mice_pending@mice.com     | pending123   | (none — /pending shell) |
 *
 * Sample workspace (idempotent): namespace `demo` / repo `sample`
 * - Manager is namespace Owner and repo Admin (admins stay out of data SoD)
 * - User is namespace member + repo write
 * - External is namespace member + repo read
 *
 * Keycloak users (stable ids) live in auth/keycloak/realm-mice.json.
 * If the realm was imported before these renames, recreate the keycloak
 * container so `--import-realm` picks up the new users.
 */

import { ensureBootstrapKey } from '../src/authentication/session/sealKeys.js'
import { canonicalIssuer } from '../src/authentication/session/principal.js'
import { ensurePrincipal, type SessionUser } from '../src/authentication/session/session.js'
import { setRepoCollaborator } from '../src/authzCollaboratorStore.js'
import { setNamespaceMember } from '../src/authzMembershipStore.js'
import { createNamespaceAuthz, getNamespace } from '../src/authzNamespaceStore.js'
import { ensureRepository } from '../src/repositoryStore.js'
import { assignRole } from '../src/rbacStore.js'
import { isInstanceRole, type InstanceRole } from '../src/rbacRoles.js'

/** Stable sample paths for local UI testing. */
const SAMPLE_NAMESPACE = 'demo'
const SAMPLE_REPO = 'sample'

type DevAccount = {
  username: string
  email: string
  name: string
  password: string
  /** Matches `id` in realm-mice.json when Keycloak Admin lookup is unavailable. */
  stableSub: string
  /** Formal role to seed, or null for the pending /pending shell account. */
  role: InstanceRole | null
  /** Admin is granted on login via AUTHZ_BOOTSTRAP_ADMINS — do not double-assign here. */
  bootstrapAdmin?: boolean
}

const ACCOUNTS: readonly DevAccount[] = [
  {
    username: 'mice_admin',
    email: 'mice_admin@mice.com',
    name: 'Admin User',
    password: 'admin123',
    stableSub: 'a0000000-0000-4000-8000-000000000001',
    role: 'admin',
    bootstrapAdmin: true,
  },
  {
    username: 'mice_manager',
    email: 'mice_manager@mice.com',
    name: 'Manager User',
    password: 'manage123',
    stableSub: 'a0000000-0000-4000-8000-000000000002',
    role: 'manager',
  },
  {
    username: 'mice_auditor',
    email: 'mice_auditor@mice.com',
    name: 'Auditor User',
    password: 'auditor123',
    stableSub: 'a0000000-0000-4000-8000-000000000003',
    role: 'auditor',
  },
  {
    username: 'mice_user',
    email: 'mice_user@mice.com',
    name: 'Regular User',
    password: 'user123',
    stableSub: 'a0000000-0000-4000-8000-000000000004',
    role: 'user',
  },
  {
    username: 'mice_external',
    email: 'mice_external@mice.com',
    name: 'External User',
    password: 'external123',
    stableSub: 'a0000000-0000-4000-8000-000000000005',
    role: 'external',
  },
  {
    username: 'mice_pending',
    email: 'mice_pending@mice.com',
    name: 'Pending User',
    password: 'pending123',
    stableSub: 'a0000000-0000-4000-8000-000000000006',
    role: null,
  },
]

function defaultIssuer(): string {
  return canonicalIssuer(
    process.env.OIDC_ISSUER_PUBLIC ||
      process.env.OIDC_ISSUER ||
      'http://localhost:8180/realms/mice',
  )
}

async function lookupKeycloakSub(username: string): Promise<string | null> {
  const adminUrl = (process.env.KEYCLOAK_ADMIN_URL || 'http://localhost:8180').replace(/\/$/, '')
  const realm = process.env.KEYCLOAK_REALM || 'mice'
  const clientId = process.env.OIDC_CLIENT_ID || 'mice-auth'
  const clientSecret = process.env.OIDC_CLIENT_SECRET || 'mice-auth-secret'

  try {
    const tokenRes = await fetch(
      `${adminUrl}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
    )
    if (!tokenRes.ok) {
      console.warn(`⚠ Keycloak token failed (${tokenRes.status}); using stable sub for ${username}`)
      return null
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string }
    if (!tokenJson.access_token) return null

    const url = new URL(`${adminUrl}/admin/realms/${encodeURIComponent(realm)}/users`)
    url.searchParams.set('username', username)
    url.searchParams.set('exact', 'true')
    const usersRes = await fetch(url, {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    })
    if (!usersRes.ok) {
      console.warn(`⚠ Keycloak user lookup failed (${usersRes.status}) for ${username}`)
      return null
    }
    const users = (await usersRes.json()) as Array<{ id?: string }>
    const id = users[0]?.id?.trim()
    return id || null
  } catch (err) {
    console.warn(`⚠ Keycloak unreachable (${String(err)}); using stable sub for ${username}`)
    return null
  }
}

/**
 * Always key grants by the IdP `sub` Keycloak will put in the token.
 * Never reuse "first principal with this email" — orphaned rows from earlier
 * Keycloak ids would steal the role and leave the real login still pending.
 */
async function resolveIdentity(account: DevAccount): Promise<{ iss: string; sub: string }> {
  const iss = defaultIssuer()
  const kcSub = await lookupKeycloakSub(account.username)
  const sub = kcSub ?? account.stableSub
  if (!kcSub) {
    console.log(
      `ℹ ${account.email}: seeding with stable sub ${sub} (recreate Keycloak if login uses another id)`,
    )
  } else if (kcSub !== account.stableSub) {
    console.warn(
      `⚠ ${account.email}: Keycloak sub ${kcSub} ≠ realm stable id ${account.stableSub}; using Keycloak sub`,
    )
  } else {
    console.log(`✓ Resolved ${account.email} via Keycloak → ${sub}`)
  }
  return { iss, sub }
}

function asSessionUser(
  account: DevAccount,
  identity: { iss: string; sub: string },
): SessionUser {
  return {
    iss: identity.iss,
    sub: identity.sub,
    email: account.email,
    name: account.name,
    emailVerified: true,
  }
}

async function seedAccount(account: DevAccount): Promise<SessionUser> {
  const identity = await resolveIdentity(account)
  await ensurePrincipal({
    ...identity,
    email: account.email,
    name: account.name,
  })
  const user = asSessionUser(account, identity)

  if (account.bootstrapAdmin) {
    console.log(`ℹ ${account.email} → admin on login (AUTHZ_BOOTSTRAP_ADMINS)`)
    return user
  }

  if (account.role == null) {
    console.log(`ℹ ${account.email} → no role (/pending shell)`)
    return user
  }

  if (!isInstanceRole(account.role)) {
    throw new Error(`Invalid role for ${account.email}: ${account.role}`)
  }

  const result = await assignRole({
    actor: null,
    target: identity,
    role: account.role,
    reason: 'dev seed',
    bootstrap: true,
  })
  if (!result.ok) {
    throw new Error(`Failed to assign ${account.role} to ${account.email}: ${result.error}`)
  }
  console.log(`✓ Assigned role ${account.role} → ${account.email}`)
  return user
}

function oxenUpstream(): string {
  return (process.env.OXEN_UPSTREAM || 'http://127.0.0.1:3001').replace(/\/$/, '')
}

/** Create the oxen-server repo (namespaces appear when the first repo is created). */
async function ensureOxenRepo(namespace: string, name: string): Promise<void> {
  const url = `${oxenUpstream()}/api/repos`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ namespace, name }),
    })
    if (res.ok) {
      console.log(`✓ Oxen repo ${namespace}/${name} ready`)
      return
    }
    const body = await res.text().catch(() => '')
    // Idempotent: oxen may return 4xx when the repo already exists.
    if (res.status === 409 || /already|exists|resource_found/i.test(body)) {
      console.log(`✓ Oxen repo ${namespace}/${name} already present`)
      return
    }
    console.warn(`⚠ Oxen create ${namespace}/${name} failed (${res.status}): ${body.slice(0, 200)}`)
  } catch (err) {
    console.warn(`⚠ Oxen unreachable at ${oxenUpstream()} (${String(err)}); AuthZ rows still seeded`)
  }
}

/**
 * One namespace + one repo for local testing.
 * Manager owns the namespace (instance admins stay out of data membership SoD).
 */
async function seedSampleWorkspace(users: {
  manager: SessionUser
  user: SessionUser
  external: SessionUser
}): Promise<void> {
  console.log(`\nSeeding sample workspace ${SAMPLE_NAMESPACE}/${SAMPLE_REPO}…`)

  const existing = await getNamespace(SAMPLE_NAMESPACE)
  if (!existing) {
    const created = await createNamespaceAuthz(users.manager, SAMPLE_NAMESPACE, 'none', true)
    if (!created.ok) {
      throw new Error(`Failed to create namespace ${SAMPLE_NAMESPACE}: ${created.error}`)
    }
    console.log(`✓ Created namespace ${SAMPLE_NAMESPACE} (owner: manager)`)
  } else {
    console.log(`✓ Namespace ${SAMPLE_NAMESPACE} already exists`)
  }

  for (const [label, target, role] of [
    ['user', users.user, 'member'],
    ['external', users.external, 'member'],
  ] as const) {
    const member = await setNamespaceMember(SAMPLE_NAMESPACE, target, role)
    if (!member.ok) {
      console.warn(`⚠ Could not add ${label} as ${role}: ${member.error}`)
    } else {
      console.log(`✓ Namespace member ${label} → ${role}`)
    }
  }

  await ensureOxenRepo(SAMPLE_NAMESPACE, SAMPLE_REPO)

  const repo = await ensureRepository(SAMPLE_NAMESPACE, SAMPLE_REPO)
  if (!repo) {
    throw new Error(`Failed to ensure AuthZ repository ${SAMPLE_NAMESPACE}/${SAMPLE_REPO}`)
  }

  for (const [label, target, role] of [
    ['manager', users.manager, 'admin'],
    ['user', users.user, 'write'],
    ['external', users.external, 'read'],
  ] as const) {
    const collab = await setRepoCollaborator(SAMPLE_NAMESPACE, SAMPLE_REPO, target, role)
    if (!collab.ok) {
      console.warn(`⚠ Could not set ${label} collaborator ${role}: ${collab.error}`)
    } else {
      console.log(`✓ Repo collaborator ${label} → ${role}`)
    }
  }
}

async function main() {
  console.log('🌱 Seeding development accounts (formal RBAC roles)…\n')

  await ensureBootstrapKey()
  console.log('✓ Seal key initialized\n')

  const byUsername = new Map<string, SessionUser>()
  for (const account of ACCOUNTS) {
    byUsername.set(account.username, await seedAccount(account))
  }

  const manager = byUsername.get('mice_manager')
  const user = byUsername.get('mice_user')
  const external = byUsername.get('mice_external')
  if (!manager || !user || !external) {
    throw new Error('Missing manager/user/external identities for sample workspace seed')
  }
  await seedSampleWorkspace({ manager, user, external })

  const pad = (s: string, n: number) => s.padEnd(n)
  console.log('\n✅ Development seed complete!\n')
  console.log('Default accounts:')
  for (const a of ACCOUNTS) {
    const roleLabel = a.bootstrapAdmin ? 'admin (bootstrap)' : a.role ?? '(none / pending)'
    console.log(`  ${pad(a.email, 28)} / ${pad(a.password, 12)} → ${roleLabel}`)
  }
  console.log(`\nSample workspace: ${SAMPLE_NAMESPACE}/${SAMPLE_REPO}`)
  console.log('  manager → namespace owner + repo admin')
  console.log('  user    → namespace member + repo write')
  console.log('  external→ namespace member + repo read')
  console.log('\nNote: Keycloak users are imported from auth/keycloak/realm-mice.json')
  console.log('If accounts are missing after a rename, recreate the keycloak service so the realm re-imports.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
