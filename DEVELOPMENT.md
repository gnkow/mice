# Development Setup

## Default Development Accounts

The development environment comes pre-configured with test accounts for each role. These accounts are defined in `auth/keycloak/realm-mice.json` and are automatically imported when Keycloak starts.

### Account Credentials

| Email | Password | Role | Description |
|-------|----------|------|-------------|
| `mice_admin@mice.com` | `admin123` | Instance Admin | Full access to all features and settings |
| `mice_manage@mice.com` | `manage123` | Manager | Delegated permissions (create namespaces, view audit, etc.) |
| `mice_auditor@mice.com` | `auditor123` | Auditor | Read-only access (requires auditor role assignment) |
| `mice_user@mice.com` | `user123` | User | Regular user (requires access request approval) |
| `mice_user_no_access@mice.com` | `noaccess123` | No Access | User with no grants at all (for testing "no access" state) |

### First-Time Setup

1. **Start the services:**
   ```bash
   docker compose up -d
   ```

2. **Wait for services to be ready** (about 30 seconds for Keycloak to import users)

3. **Seed permissions:**
   ```bash
   npm run seed:dev --prefix auth
   ```

   This script will:
   - Grant instance admin to `mice_admin@mice.com`
   - Grant delegated permissions to `mice_manage@mice.com`
   - Set up principals for all accounts

4. **Login with any account:**
   - Navigate to `http://localhost:5173`
   - Login with one of the accounts above

### Account Roles Explained

#### Instance Administrator (`mice_admin@mice.com`)
- Automatically granted instance admin on first login (via `AUTHZ_BOOTSTRAP_ADMINS`)
- Full access to:
  - All namespaces and repositories
  - Security settings (IdP baseline, session keys, user revocations)
  - Admin settings (administrators, permissions, announcements)
- Can approve access requests
- Can manage other users' permissions

#### Manager (`mice_manage@mice.com`)
- Pre-configured with delegated permissions:
  - `create_namespace` - Create new namespaces
  - `view_audit` - View audit logs
  - `view_lineage` - View lineage reports
  - `manage_own_tokens` - Manage personal API tokens
  - `cli_device_approve` - Approve CLI device codes
  - `session_create` - Create workspace sessions
  - `session_connect` - Connect to workspace sessions
- Cannot modify instance-level settings
- Can be granted additional permissions by admins

#### Auditor (`mice_auditor@mice.com`)
- Requires manual auditor role assignment by an admin
- Read-only access to audit logs and system records
- Cannot modify any data
- MFA evidence required (if configured)
- Access expires at admin-set date

#### Regular User (`mice_user@mice.com`)
- Starts in "pending" state
- Must submit access request
- Needs approval from admin or namespace owner
- Once approved, can access granted namespaces/repositories

#### No Access User (`mice_user_no_access@mice.com`)
- Has no grants at all (not even pending)
- Perfect for testing the "no access" state
- Can login but has no permissions
- Useful for testing permission denial flows and UI states

## Who becomes an instance admin

Only identities listed in `AUTHZ_BOOTSTRAP_ADMINS` are granted instance admin, and only on login. Everyone else keeps the role the seed script or an administrator assigned.

```bash
AUTHZ_BOOTSTRAP_ADMINS=mice_admin@mice.com
```

**What happens:**
- Login as `mice_admin@mice.com` → instance admin
- Login as `mice_manage@mice.com` → delegated permissions only
- Login as `mice_user@mice.com` → pending until an access request is approved
- Login as `mice_auditor@mice.com` → read-only after an administrator assigns the auditor role

**Permission flow:**
```typescript
// Called on every login in preparePrincipal()
maybeBootstrapInstanceAdmin(user)  // mice_admin@mice.com → admin
```

Everyone else starts with no grants and requests access. An administrator or namespace owner grants it. An IdP group grants access only after an administrator has added that group to a namespace or repository.

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

# 2. Run seed script to set up permissions
npm run seed:dev --prefix auth

# 3. Login with different accounts to work with different permission levels
#    - mice_admin@mice.com → full admin access
#    - mice_manage@mice.com → manager with delegated permissions
#    - mice_user@mice.com → regular user, needs approval
#    - mice_auditor@mice.com → read-only auditor
```

### Adding More Test Users

To add more test users, edit `auth/keycloak/realm-mice.json`:

```json
{
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

Then restart Keycloak:
```bash
docker compose restart keycloak
```

### Troubleshooting

**Users not showing up:**
- Check Keycloak logs: `docker compose logs keycloak`
- Verify realm import: `auth/keycloak/realm-mice.json` should be mounted

**Admin permissions not working:**
- Verify `AUTHZ_BOOTSTRAP_ADMINS` includes the user's email
- Re-run seed script: `npm run seed:dev --prefix auth`
- Check database: `psql -U mice -d mice -c "SELECT * FROM instance_admins;"`

**"Pending user" message:**
- This is expected for users not in `AUTHZ_BOOTSTRAP_ADMINS`
- An administrator must approve the access request
