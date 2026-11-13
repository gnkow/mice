# Authentication Test Harness

This directory contains the test IdP harness and utilities for end-to-end authentication testing.

## Overview

The test harness provides:

1. **Fake IdP** - An in-process identity provider that issues real JWT tokens
2. **Controllable Clock** - Time control for testing expiration and time-based scenarios
3. **Table-Driven Test Format** - A documented pattern for authentication test suites

## Quick Start

```typescript
import { createAuthTestApp } from './authTestApp.js'

const app = createAuthTestApp({
  users: [
    { sub: 'alice', email: 'alice@example.com', name: 'Alice Admin' },
    { sub: 'bob', email: 'bob@guest.com', name: 'Bob Guest' },
  ],
})

// Complete a login through the harness seam (code/PKCE stay inside)
const { sessionCookie } = await app.signIn('alice')

// Issue a token for a user
const token = await app.idp.issueToken('alice')

// Decode and verify the token
const claims = await app.idp.decodeToken(token)
console.log(claims.sub)  // 'alice'
console.log(claims.email) // 'alice@example.com'

// Control time for testing
app.clock.advance(60 * 60 * 1000)  // Advance 1 hour
```

## Fake IdP

The fake IdP issues real JWT tokens signed with a test key. Tokens include:

- Standard OIDC claims: `sub`, `iss`, `aud`, `iat`, `exp`
- User profile claims: `email`, `name`

### Configurable Users

Users are configured at app creation. Each user needs:

```typescript
{
  sub: string     // Subject identifier (unique)
  email: string   // Email address
  name: string    // Display name
}
```

### Token Issuance

```typescript
const token = await app.idp.issueToken('alice')
```

Throws an error if the user doesn't exist.

### Token Decoding

```typescript
const claims = await app.idp.decodeToken(token)
```

Verifies the signature and returns all claims. Expiration checking is disabled for test convenience.

## Clock Control

The test harness provides a `FakeClock` that can be controlled:

```typescript
const now = app.clock.now()           // Get current time (ms)
app.clock.advance(60000)              // Advance 60 seconds
app.clock.set(Date.UTC(2026, 0, 1))  // Set to specific time
```

The clock is shared between the IdP and any BFF components that use it.

## Table-Driven Test Format

The recommended pattern for authentication tests:

```typescript
await it('login scenarios', async () => {
  const testCases = [
    {
      name: 'admin can login',
      sub: 'admin',
      email: 'admin@example.com',
      expectSuccess: true,
    },
    {
      name: 'guest can login',
      sub: 'guest',
      email: 'guest@example.com',
      expectSuccess: true,
    },
  ]

  const app = createAuthTestApp({
    users: testCases.map(tc => ({ 
      sub: tc.sub, 
      email: tc.email, 
      name: tc.sub 
    })),
  })

  for (const tc of testCases) {
    const token = await app.idp.issueToken(tc.sub)
    assert.ok(token, `${tc.name}: expected token`)
    
    // Additional assertions based on tc.expectSuccess, etc.
  }
})
```

This pattern makes it easy to:
- Add new scenarios by adding table rows
- See all test cases at a glance
- Share setup across scenarios

## Example: Complete Test Suite

See `authTestApp.test.ts` for a complete working example including:

1. Basic token issuance
2. Clock control
3. Table-driven scenarios
4. User attribute verification
5. Contract tests for OIDC compliance

## Implementation Notes

- Tokens are signed with HS256 using a fixed test key
- Token expiration is set to 1 hour from issuance
- Expiration checking is disabled in `decodeToken()` for test convenience
- The IdP issuer is `https://test-idp.example.com`
- The audience is `test-audience`

## Login seam

`signIn(sub)` is the public login interface: it starts `/auth/login`, issues the IdP code, completes `/auth/callback`, and returns the session cookie. Authorization codes and PKCE choreography are implementation details behind that seam.

Guest, missing-name, MFA, and non-MFA users are covered by the `IdpAdapter` contract (`idpAdapter.contract.test.ts` / `createFakeIdpAdapter`).
