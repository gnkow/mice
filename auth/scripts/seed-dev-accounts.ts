#!/usr/bin/env tsx
/**
 * Development seed: one Keycloak account per formal RBAC role, plus a pending user,
 * and one sample namespace + repository for local UI testing.
 *
 * | Email                     | Password     | Role     |
 * |---------------------------|--------------|----------|
 * | mice_admin@mice.com       | admin123 (+ TOTP) | admin (AUTHZ_BOOTSTRAP_ADMINS on login) |
 * | mice_no_mfa@mice.com      | nomfa123     | user (password-only control) |
 * | mice_manager@mice.com     | manage123    | manager  |
 * | mice_auditor@mice.com     | auditor123   | auditor  |
 * | mice_user@mice.com        | user123      | user (default SSO / e2e; MFA) |
 * | mice_user_2@mice.com      | user2123     | user (MFA collaborator) |
 * | mice_user_3@mice.com      | user3123     | user (MFA collaborator) |
 * | mice_external@mice.com    | external123  | external |
 * | mice_pending@mice.com     | pending123   | (none — /pending shell) |
 * | partner@partner.example   | partner      | user (SAML broker e2e; not bootstrap admin) |
 *
 * Sample workspace (idempotent): namespace `demo` / repo `sample`
 * - Manager is namespace Owner only (no auto repo collaborator seat)
 * - `mice_user`, `mice_user_2`, `mice_user_3` are namespace members + repo write
 * - External is namespace member + repo read
 * - Oxen `main` exists as an empty tip (workspace init; no seed files)
 *
 * Keycloak users (stable ids) live in auth/keycloak/realm-mice.json.
 * If the realm was imported before these renames, recreate the keycloak
 * container so `--import-realm` picks up the new users.
 */

import { ensureBootstrapKey } from '../src/authentication/session/sealKeys.js'
import { canonicalIssuer } from '../src/authentication/session/principal.js'
import { ensurePrincipal, type SessionUser } from '../src/authentication/session/session.js'
import { removeRepoCollaborator, setRepoCollaborator } from '../src/authzCollaboratorStore.js'
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
    // Password-only control: Conditional OTP skipped (no TOTP credential). Not bootstrap admin.
    username: 'mice_no_mfa',
    email: 'mice_no_mfa@mice.com',
    name: 'No Mfa',
    password: 'nomfa123',
    stableSub: 'a0000000-0000-4000-8000-000000000010',
    role: 'user',
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
    username: 'mice_user_2',
    email: 'mice_user_2@mice.com',
    name: 'Regular User Two',
    password: 'user2123',
    stableSub: 'a0000000-0000-4000-8000-000000000008',
    role: 'user',
  },
  {
    username: 'mice_user_3',
    email: 'mice_user_3@mice.com',
    name: 'Regular User Three',
    password: 'user3123',
    stableSub: 'a0000000-0000-4000-8000-000000000009',
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
  {
    // SAML broker e2e (`partner-saml` → mice). Granted User so SSO sees topbar; not instance Admin.
    username: 'partner',
    email: 'partner@partner.example',
    name: 'Partner User',
    password: 'partner',
    stableSub: 'a0000000-0000-4000-8000-000000000007',
    role: 'user',
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

  if (account.role == null) {
    console.log(`ℹ ${account.email} → no role (/pending shell)`)
    return user
  }

  if (!isInstanceRole(account.role)) {
    throw new Error(`Invalid role for ${account.email}: ${account.role}`)
  }

  // Bootstrap admins are also allowlisted in AUTHZ_BOOTSTRAP_ADMINS (login path).
  // Still assign here so seed can demote other principals without waiting for SSO.
  const result = await assignRole({
    actor: null,
    target: identity,
    role: account.role,
    reason: account.bootstrapAdmin ? 'bootstrap' : 'dev seed',
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

const UUID_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Drop AuthZ rows whose *name* is a UUID (leftover from list-leakage minting).
 * Keeps the real display-named sample repo.
 */
async function purgeUuidNamedRepos(namespace: string, keepId: string): Promise<void> {
  const { getDb } = await import('../src/db/database.js')
  const { repositories, namespaces } = await import('../src/db/schema.js')
  const { eq } = await import('drizzle-orm')
  const { deleteRepositoryRecord } = await import('../src/repositoryStore.js')
  const rows = await getDb()
    .select({ id: repositories.id, name: repositories.name })
    .from(repositories)
    .innerJoin(namespaces, eq(namespaces.id, repositories.namespaceId))
    .where(eq(namespaces.name, namespace))
  let purged = 0
  for (const row of rows) {
    if (row.id === keepId) continue
    if (!UUID_NAME_RE.test(row.name)) continue
    const result = await deleteRepositoryRecord(namespace, row.name)
    if (result.ok) purged += 1
  }
  if (purged) {
    console.log(`✓ Purged ${purged} UUID-named AuthZ repo row(s) under ${namespace}`)
  }
}

/** Create the oxen-server repo (namespaces appear when the first repo is created). */
async function ensureOxenRepo(namespace: string, name: string): Promise<boolean> {
  const url = `${oxenUpstream()}/api/repos`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ namespace, name }),
    })
    if (res.ok) {
      console.log(`✓ Oxen repo ${namespace}/${name} ready`)
      return true
    }
    const body = await res.text().catch(() => '')
    // Idempotent: oxen may return 4xx when the repo already exists.
    if (res.status === 409 || /already|exists|resource_found/i.test(body)) {
      console.log(`✓ Oxen repo ${namespace}/${name} already present`)
      return true
    }
    console.warn(`⚠ Oxen create ${namespace}/${name} failed (${res.status}): ${body.slice(0, 200)}`)
    return false
  } catch (err) {
    console.warn(`⚠ Oxen unreachable at ${oxenUpstream()} (${String(err)}); AuthZ rows still seeded`)
    return false
  }
}

/**
 * One namespace + one repo for local testing.
 * Manager owns the namespace (instance admins stay out of data membership SoD).
 * Default SSO `mice_user` gets write so `make reset` leaves a usable workspace.
 */
async function seedSampleWorkspace(users: {
  manager: SessionUser
  user: SessionUser
  user2: SessionUser
  user3: SessionUser
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
    ['user_2', users.user2, 'member'],
    ['user_3', users.user3, 'member'],
    ['external', users.external, 'member'],
  ] as const) {
    const member = await setNamespaceMember(SAMPLE_NAMESPACE, target, role)
    if (!member.ok) {
      console.warn(`⚠ Could not add ${label} as ${role}: ${member.error}`)
    } else {
      console.log(`✓ Namespace member ${label} → ${role}`)
    }
  }

  // Mint AuthZ ids first; oxen physical keys are those stable UUIDs (display names stay in AuthZ).
  const repo = await ensureRepository(SAMPLE_NAMESPACE, SAMPLE_REPO)
  if (!repo) {
    throw new Error(`Failed to ensure AuthZ repository ${SAMPLE_NAMESPACE}/${SAMPLE_REPO}`)
  }
  await purgeUuidNamedRepos(SAMPLE_NAMESPACE, repo.id)
  const oxenReady = await ensureOxenRepo(repo.namespaceId, repo.id)
  console.log(
    `✓ Oxen physical path ${repo.namespaceId}/${repo.id} ↔ display ${SAMPLE_NAMESPACE}/${SAMPLE_REPO}`,
  )
  if (oxenReady) {
    const { ensureEmptyOxenBranch } = await import('../src/oxenEmptyBranch.js')
    // Attribute empty tip to the namespace owner (manager), not oxen's hardcoded author.
    const emptyMain = await ensureEmptyOxenBranch(
      repo.namespaceId,
      repo.id,
      'main',
      users.manager,
    )
    if (emptyMain.ok) {
      console.log('✓ Oxen sample branch main ready (empty tip, attributed to manager)')
    } else {
      console.warn(`⚠ Oxen empty main failed: ${emptyMain.error}`)
    }
  }

  // Collaborators are opt-in (source of truth for data access). Manager stays
  // Owner-only so they manage seats without an automatic Admin grant.
  if (await removeRepoCollaborator(SAMPLE_NAMESPACE, SAMPLE_REPO, users.manager)) {
    console.log('✓ Cleared leftover manager collaborator seat on sample')
  }
  for (const [label, target, role] of [
    ['user', users.user, 'write'],
    ['user_2', users.user2, 'write'],
    ['user_3', users.user3, 'write'],
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

/**
 * Keycloak's oidc-amr-mapper only emits `amr` when browser-flow authenticators
 * have Authenticator Reference values. Realm import may skip built-in flow
 * updates on an existing DB — ensure pwd/otp refs (with maxAge) idempotently.
 */
async function ensureKeycloakAmrAuthenticatorRefs(): Promise<void> {
  const adminUrl = (process.env.KEYCLOAK_ADMIN_URL || 'http://localhost:8180').replace(/\/$/, '')
  const realm = process.env.KEYCLOAK_REALM || 'mice'
  const username = process.env.KEYCLOAK_ADMIN || 'admin'
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin'

  const wanted: Record<string, { alias: string; value: string }> = {
    'auth-username-password-form': { alias: 'amr-pwd', value: 'pwd' },
    'auth-otp-form': { alias: 'amr-otp', value: 'otp' },
  }

  try {
    const tokenRes = await fetch(`${adminUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username,
        password,
      }),
    })
    if (!tokenRes.ok) {
      console.warn(`⚠ Keycloak admin token failed (${tokenRes.status}); skip AMR authenticator refs`)
      return
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string }
    if (!tokenJson.access_token) {
      console.warn('⚠ Keycloak admin token missing; skip AMR authenticator refs')
      return
    }
    const auth = { Authorization: `Bearer ${tokenJson.access_token}` }

    const execRes = await fetch(
      `${adminUrl}/admin/realms/${encodeURIComponent(realm)}/authentication/flows/browser/executions`,
      { headers: auth },
    )
    if (!execRes.ok) {
      console.warn(`⚠ Keycloak browser executions failed (${execRes.status}); skip AMR refs`)
      return
    }
    const executions = (await execRes.json()) as Array<{
      id?: string
      providerId?: string
      authenticatorConfig?: string | null
    }>

    for (const exec of executions) {
      const provider = exec.providerId
      const spec = provider ? wanted[provider] : undefined
      if (!spec || !exec.id) continue
      // Flow execution list often omits authenticatorConfig; fetch the execution.
      let configId = exec.authenticatorConfig ?? null
      if (!configId) {
        const detailRes = await fetch(
          `${adminUrl}/admin/realms/${encodeURIComponent(realm)}/authentication/executions/${exec.id}`,
          { headers: auth },
        )
        if (detailRes.ok) {
          const detail = (await detailRes.json()) as { authenticatorConfig?: string | null }
          configId = detail.authenticatorConfig ?? null
        }
      }
      if (configId) {
        const cfgRes = await fetch(
          `${adminUrl}/admin/realms/${encodeURIComponent(realm)}/authentication/config/${configId}`,
          { headers: auth },
        )
        if (cfgRes.ok) {
          const cfg = (await cfgRes.json()) as { config?: Record<string, string> }
          if (cfg.config?.['default.reference.value'] === spec.value) {
            console.log(`✓ Keycloak AMR ref already set: ${provider} → ${spec.value}`)
            continue
          }
        }
      }
      const createRes = await fetch(
        `${adminUrl}/admin/realms/${encodeURIComponent(realm)}/authentication/executions/${exec.id}/config`,
        {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alias: spec.alias,
            config: {
              'default.reference.value': spec.value,
              // Avoid Keycloak amr maxAge=0 drop across token-exchange second boundary.
              'default.reference.maxAge': '3600',
            },
          }),
        },
      )
      if (createRes.ok || createRes.status === 201) {
        console.log(`✓ Keycloak AMR ref configured: ${provider} → ${spec.value}`)
      } else {
        console.warn(
          `⚠ Could not set AMR ref for ${provider} (${createRes.status}); MFA profile may stay password-only`,
        )
      }
    }
  } catch (err) {
    console.warn(`⚠ Keycloak AMR ensure failed (${String(err)}); MFA claims may be empty`)
  }
}

async function main() {
  console.log('🌱 Seeding development accounts (formal RBAC roles)…\n')

  await ensureBootstrapKey()
  console.log('✓ Seal key initialized\n')

  await ensureKeycloakAmrAuthenticatorRefs()
  console.log('')

  const byUsername = new Map<string, SessionUser>()
  for (const account of ACCOUNTS) {
    byUsername.set(account.username, await seedAccount(account))
  }

  const manager = byUsername.get('mice_manager')
  const user = byUsername.get('mice_user')
  const user2 = byUsername.get('mice_user_2')
  const user3 = byUsername.get('mice_user_3')
  const external = byUsername.get('mice_external')
  if (!manager || !user || !user2 || !user3 || !external) {
    throw new Error(
      'Missing manager/user/user_2/user_3/external identities for sample workspace seed',
    )
  }
  await seedSampleWorkspace({ manager, user, user2, user3, external })

  const pad = (s: string, n: number) => s.padEnd(n)
  console.log('\n✅ Development seed complete!\n')
  console.log('Default accounts:')
  for (const a of ACCOUNTS) {
    const roleLabel = a.bootstrapAdmin ? 'admin (bootstrap)' : a.role ?? '(none / pending)'
    console.log(`  ${pad(a.email, 28)} / ${pad(a.password, 12)} → ${roleLabel}`)
  }
  console.log(`\nSample workspace: ${SAMPLE_NAMESPACE}/${SAMPLE_REPO}`)
  console.log('  manager           → namespace owner (no auto collaborator seat)')
  console.log('  mice_user{,_2,_3} → namespace member + repo write (default SSO / MFA)')
  console.log('  mice_external     → namespace member + repo read')
  console.log('\nNote: Keycloak users are imported from auth/keycloak/realm-mice.json')
  console.log('If accounts are missing after a rename, recreate the keycloak service so the realm re-imports.')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seed failed:', err)
    process.exit(1)
  })
