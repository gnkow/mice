# Development Setup

## Default Development Accounts

The development environment comes pre-configured with test accounts for each formal RBAC role, plus a pending user for the `/pending` shell. Accounts are defined in `auth/keycloak/realm-mice.json` and imported when Keycloak starts. Roles (except bootstrap admin) are applied by the seed script.

### Account Credentials

| Email | Password | Formal role | Description |
|-------|----------|-------------|-------------|
| `mice_admin@mice.com` | `admin123` | `admin` | Instance admin via `AUTHZ_BOOTSTRAP_ADMINS` on login |
| `mice_manager@mice.com` | `manage123` | `manager` | Review access requests up to Manager |
| `mice_auditor@mice.com` | `auditor123` | `auditor` | Read-only / `repo:bypass_acl` |
| `mice_user@mice.com` | `user123` | `user` | Standard collaborator (already approved) |
| `mice_external@mice.com` | `external123` | `external` | Read-only guest |
| `mice_pending@mice.com` | `pending123` | *(none)* | No role — `/pending` request wizard |

### First-Time Setup

1. **Start the services:**
   ```bash
   docker compose up -d
   ```

2. **Wait for services to be ready** (about 30 seconds for Keycloak to import users)

3. **Seed roles:**
   ```bash
   npm run seed:dev --prefix auth
   ```

   This script will:
   - Ensure principals for each account (resolving Keycloak `sub` when the Admin API is reachable)
   - Assign formal `manager` / `auditor` / `user` / `external` roles
   - Leave `mice_pending` without a role
   - Leave `mice_admin` to bootstrap Admin on first login (`AUTHZ_BOOTSTRAP_ADMINS`)
   - Create sample workspace `demo` / `sample` (manager owns it; user write; external read)

4. **Login with any account:**
   - Navigate to `http://localhost:5173`
   - Login with one of the accounts above

### Account Roles Explained

#### Instance Administrator (`mice_admin@mice.com`)
- Automatically granted Admin on login (via `AUTHZ_BOOTSTRAP_ADMINS`)
- Full instance settings, grants, and access-request approval

#### Manager (`mice_manager@mice.com`)
- Formal `manager` role from seed
- Can review access requests up to Manager authority
- Cannot change instance-level admin settings

#### Auditor (`mice_auditor@mice.com`)
- Formal `auditor` role from seed
- Read-oriented catalog including private-repo read via `repo:bypass_acl`

#### User (`mice_user@mice.com`)
- Formal `user` role from seed — ready to use without an access request
- Write in repositories where they are a collaborator

#### External (`mice_external@mice.com`)
- Formal `external` role from seed
- Read-focused guest access

#### Pending (`mice_pending@mice.com`)
- No formal role — lands on `/pending`
- Use to exercise Request Access / update-pending flows

### Sample workspace

`npm run seed:dev --prefix auth` also ensures one test namespace and repository:

| Path | Access |
|------|--------|
| `demo` / `sample` | Manager = namespace owner + repo admin; User = member + write; External = member + read |

Instance admins stay out of namespace membership (separation of duties). Open `/namespaces/demo` or `/namespaces/demo/sample` after logging in as manager or user.

## Who becomes an instance admin

Only identities listed in `AUTHZ_BOOTSTRAP_ADMINS` are granted instance admin, and only on login. Everyone else keeps the role the seed script or an administrator assigned.

```bash
AUTHZ_BOOTSTRAP_ADMINS=mice_admin@mice.com
```

**What happens:**
- Login as `mice_admin@mice.com` → Admin
- Login as `mice_manager@mice.com` → Manager (after seed)
- Login as `mice_user@mice.com` → User (after seed)
- Login as `mice_external@mice.com` → External (after seed)
- Login as `mice_auditor@mice.com` → Auditor (after seed)
- Login as `mice_pending@mice.com` → pending until an access request is approved

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
# 1. Start services
docker compose up -d

# 2. Run seed script to assign formal roles
npm run seed:dev --prefix auth

# 3. Login with different accounts
#    - mice_admin@mice.com    → admin
#    - mice_manager@mice.com  → manager
#    - mice_auditor@mice.com  → auditor
#    - mice_user@mice.com     → user
#    - mice_external@mice.com → external
#    - mice_pending@mice.com  → /pending shell
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
- Re-run seed script: `npm run seed:dev --prefix auth`

**"Pending user" / Request access shell:**
- Expected for `mice_pending@mice.com` (no formal role)
- Other seeded accounts should not land there after a successful seed
