# Development Setup

## Default Development Accounts

The development environment comes pre-configured with test accounts for each formal RBAC role, plus a pending user for the `/pending` shell. Accounts are defined in `auth/keycloak/realm-mice.json` and imported when Keycloak starts. Roles (except bootstrap admin) are applied by the seed script.

### Account credentials

Accounts live in `auth/keycloak/realm-mice.json`; formal roles, the `demo` / `sample` workspace, and the seeded pending User request for `mice_pending` are applied by `make seed` / `seed:dev`. New Keycloak users added to the realm file are created on seed when missing (service account needs `manage-users`); a full `make reset` re-imports the realm.

| Username | Email | Password | Role | MFA | Notes |
|----------|-------|----------|------|-----|-------|
| `mice_admin` | `mice_admin@mice.com` | `admin123` | `admin` | TOTP | Bootstrap instance admin (`AUTHZ_BOOTSTRAP_ADMINS`) |
| `mice_manager` | `mice_manager@mice.com` | `manage123` | `manager` | TOTP | Owns namespace `demo`; signed ceremonies |
| `mice_auditor` | `mice_auditor@mice.com` | `auditor123` | `auditor` | TOTP | Read / `repo:bypass_acl` |
| `mice_auditor_no_mfa` | `mice_auditor_no_mfa@mice.com` | `auditornmfa123` | `auditor` | — | Password-only Auditor; MFA gate / shell banner control |
| `mice_user` | `mice_user@mice.com` | `user123` | `user` | TOTP | Default SSO / e2e (`KEYCLOAK_E2E_USER`); `demo/sample` write; IdP group `engineering` |
| `mice_user_2` | `mice_user_2@mice.com` | `user2123` | `user` | TOTP | Second MFA collaborator; `demo/sample` write; IdP group `engineering` |
| `mice_user_3` | `mice_user_3@mice.com` | `user3123` | `user` | TOTP | Third MFA collaborator; `demo/sample` write; IdP group `engineering` |
| `mice_no_mfa` | `mice_no_mfa@mice.com` | `nomfa123` | `user` | — | Password-only control; Profile MFA **No**; ceremonies refuse |
| `mice_external` | `mice_external@mice.com` | `external123` | `external` | — | Guest; `demo/sample` read |
| `mice_no_access` | `mice_no_access@mice.com` | `noaccess123` | *(none)* | — | Blank `/pending` wizard (no request filed) |
| `mice_pending` | `mice_pending@mice.com` | `pending123` | *(none)* | — | Seeded pending **User** request (visible in Settings → Access requests) |
| `partner` | `partner@partner.example` | `partner` | `user` | — | SAML broker e2e |

#### Dev MFA (OTP)

Shared TOTP secret for all OTP-enabled accounts: `JBSWY3DPEHPK3PXP` (UTF-8 key material, not base32).

On the Keycloak OTP screen the **mice-dev** login theme shows **Dev OTP** with the live 6-digit code. **Click the code** to copy it and fill the OTP field (dev only). Seed also configures Keycloak `amr` authenticator refs if realm import skipped built-in flow updates.

### First-Time Setup

1. **Start (and seed) the stack:**
   ```bash
   make up
   ```

   `make up` (and `make reset`, which wipes volumes then calls `up`) wait for
   Postgres, immudb, Keycloak, and auth, then run `seed:dev` inside the auth
   container. That script:
   - Ensures principals for each account (resolving Keycloak `sub` when the Admin API is reachable)
   - Assigns formal `manager` / `auditor` / `user` / `external` roles
   - Leaves `mice_no_access` and `mice_pending` without a role (`/pending` shell);
     seeds a pending **User** access request for `mice_pending` only
   - Leaves `mice_admin` to bootstrap Admin on login (`AUTHZ_BOOTSTRAP_ADMINS`)
   - Creates sample workspace `demo` / `sample` (manager owns it; `mice_user` /
     `_2` / `_3` write; external read)

   Re-seed anytime with `make seed` (stack must already be up).

2. **Login with any account:**
   - Navigate to `http://localhost:5173`
   - Login with one of the accounts above

### Account Roles Explained

#### Instance Administrator (`mice_admin@mice.com`)
- Automatically granted Admin on login (via `AUTHZ_BOOTSTRAP_ADMINS`)
- Requires OTP at Keycloak (shared e2e TOTP secret above)
- Full instance settings, grants, and access-request approval

#### Manager (`mice_manager@mice.com`)
- Formal `manager` role from seed
- Can review access requests up to Manager authority
- Cannot change instance-level admin settings
- Has TOTP so namespace rename / other signed ceremonies can complete MFA step-up

#### Auditor (`mice_auditor@mice.com`)
- Formal `auditor` role from seed
- Read-oriented catalog including private-repo read via `repo:bypass_acl`
- Has TOTP (auditor routes require MFA evidence)

#### Auditor without MFA (`mice_auditor_no_mfa@mice.com`)
- Formal `auditor` role from seed, **password-only** (no TOTP credential)
- After SSO: shell shows the MFA-required banner; data routes return 403 until MFA is present
- Use to exercise ticket 17 (Auditor MFA on every request) without stripping OTP from `mice_auditor`

#### User (`mice_user@mice.com`, `mice_user_2`, `mice_user_3`)
- Formal `user` role from seed — ready to use without an access request
- `mice_user` is the default local SSO / e2e login (`KEYCLOAK_E2E_USER`)
- Write in repositories where they are a collaborator (including `demo` / `sample`)
- Has TOTP for signed writes
- Extra `_2` / `_3` accounts are for multi-actor flows (e.g. one opens an MR, another signs)

#### External (`mice_external@mice.com`)
- Formal `external` role from seed
- Read-focused guest access

#### No access (`mice_no_access@mice.com`)
- No formal role and **no** access request — lands on the blank Request Access wizard
- Use to exercise filing a new request from scratch

#### Pending (`mice_pending@mice.com`)
- No formal role — lands on `/pending` with a **seeded pending User request**
- Visible to managers/admins under Settings → Access requests after `make seed` / `make reset`
- Use to exercise approve / deny / update-pending flows

### Sample workspace

`make seed` also ensures one test namespace and repository:

| Path | Access |
|------|--------|
| `demo` / `sample` | Manager = namespace owner; `mice_user{,_2,_3}` = member + write; External = member + read |

Instance admins stay out of namespace membership (separation of duties). After `make reset` / `make up`, log in as `mice_user@mice.com` and open `/namespaces/demo` or `/namespaces/demo/sample`.

## Who becomes an instance admin

Only identities listed in `AUTHZ_BOOTSTRAP_ADMINS` are granted instance admin, and only on login. Everyone else keeps the role the seed script or an administrator assigned.

```bash
AUTHZ_BOOTSTRAP_ADMINS=mice_admin@mice.com
```

**What happens:**
- Login as `mice_admin@mice.com` → Admin (bootstrap; OTP)
- Login as `mice_no_mfa@mice.com` → User (password-only; after seed)
- Login as `partner@partner.example` → User (after seed; not bootstrap)
- Login as `mice_manager@mice.com` → Manager (after seed)
- Login as `mice_user@mice.com` / `_2` / `_3` → User (after seed; OTP)
- Login as `mice_external@mice.com` → External (after seed)
- Login as `mice_auditor@mice.com` → Auditor (after seed; OTP)
- Login as `mice_auditor_no_mfa@mice.com` → Auditor without MFA evidence (banner + 403 on data routes)
- Login as `mice_no_access@mice.com` → blank `/pending` wizard (no request yet)
- Login as `mice_pending@mice.com` → `/pending` with a seeded User request until approved/denied

**Permission flow:**
```typescript
// Called on every login in preparePrincipal()
maybeBootstrapInstanceAdmin(user)  // mice_admin@mice.com → admin
```

Everyone else starts with the seeded role (or none). An administrator grants further access. An IdP group grants access only after an administrator has added that group to a namespace or repository.

### Bootstrap configuration

```bash
# Single admin
AUTHZ_BOOTSTRAP_ADMINS=mice_admin@mice.com

# Multiple admins (comma-separated)
AUTHZ_BOOTSTRAP_ADMINS=admin@company.com,ops@company.com
```

**How it works:**
- Checked on every login in `maybeBootstrapInstanceAdmin()`
- A verified email, or an `iss|sub` entry, on the list is granted instance admin
- That grant happens even when other admins already exist

**Production note:** Authorization is always enforced. There is no switch to turn it off.

### Local setup

```bash
# Start stack + seed formal roles (mice_no_access + mice_pending stay role-less)
make up

# Or re-seed after the stack is already up:
make seed

# Login:
#    - mice_admin@mice.com     → admin (bootstrap; OTP)
#    - mice_no_mfa@mice.com    → user (password-only)
#    - mice_manager@mice.com   → manager
#    - mice_auditor@mice.com   → auditor
#    - mice_user@mice.com      → user (default SSO; OTP)
#    - mice_user_2@mice.com    → user (OTP)
#    - mice_user_3@mice.com    → user (OTP)
#    - mice_external@mice.com  → external
#    - mice_no_access@mice.com → blank /pending wizard
#    - mice_pending@mice.com   → /pending with seeded User request
```

### Adding More Test Users

To add more test users, edit `auth/keycloak/realm-mice.json`:

```json
{
  "id": "a0000000-0000-4000-8000-0000000000xx",
  "username": "newuser",
  "enabled": true,
  "email": "newuser@mice.com",
  "emailVerified": true,
  "firstName": "New",
  "lastName": "User",
  "credentials": [
    {
      "type": "password",
      "value": "password123",
      "temporary": false
    }
  ]
}
```

Then recreate Keycloak so `--import-realm` runs on an empty store (import is skipped when the realm already exists):

```bash
docker compose rm -sf keycloak && docker compose up -d keycloak
```

Update `auth/scripts/seed-dev-accounts.ts` if the account should receive a formal role.

### Troubleshooting

**Users not showing up:**
- Check Keycloak logs: `docker compose logs keycloak`
- Verify realm import: `auth/keycloak/realm-mice.json` should be mounted
- Recreate Keycloak after renames (see above)

**Admin permissions not working:**
- Verify `AUTHZ_BOOTSTRAP_ADMINS` includes the user's email
- Re-run seed: `make seed`

**"Pending user" / Request access shell:**
- Expected for `mice_pending@mice.com` (no formal role)
- Other seeded accounts should not land there after a successful seed
