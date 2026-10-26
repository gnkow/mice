import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { EncryptJWT, jwtDecrypt } from 'jose'
import { createHash } from 'node:crypto'
import { fakeClock, type FakeClock } from '../../clock.js'
import { createFakeIdp, type FakeIdp } from './fakeIdp.js'
import type { SessionUser } from '../session/session.js'

export interface AuthTestAppOptions {
  users: Array<{ sub: string; email: string; name: string }>
}

export interface AuthTestApp {
  idp: FakeIdp
  clock: FakeClock
  bff: Hono
  /**
   * Internal helper to issue an authorization code for testing.
   * In a real flow, this happens at the IdP.
   */
  issueAuthCode(sub: string, state: string): string
}

interface PkceState {
  verifier: string
  state: string
  nonce: string
  createdAt: number // timestamp in ms
}

// Test session secret
const TEST_SESSION_SECRET = 'test-session-secret-key-for-testing-only-32-chars!'
const testSecretKey = () => createHash('sha256').update(TEST_SESSION_SECRET).digest()

async function sealTestSession(user: SessionUser): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000)
  return new EncryptJWT({
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
    email_verified: user.emailVerified === true,
    sat: nowSec,
    act: nowSec,
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(nowSec + 28800) // 8 hours
    .encrypt(testSecretKey())
}

export function createAuthTestApp(options: AuthTestAppOptions): AuthTestApp {
  const clock = fakeClock()
  const idp = createFakeIdp(options.users, clock)
  
  // In-memory storage for PKCE states and issued codes
  const pkceStates = new Map<string, PkceState>()
  const issuedCodes = new Map<string, { sub: string; state: string }>()
  
  // Create a minimal BFF app with authentication routes
  const bff = new Hono()
  
  // /auth/login - initiates OIDC flow
  bff.get('/auth/login', async (c) => {
    const state = `state_${Math.random().toString(36).slice(2)}`
    const verifier = `verifier_${Math.random().toString(36).slice(2)}`
    const nonce = `nonce_${Math.random().toString(36).slice(2)}`
    
    const pkce: PkceState = { verifier, state, nonce, createdAt: clock.now() }
    pkceStates.set(state, pkce)
    
    const pkceCookie = Buffer.from(JSON.stringify({ verifier, state, nonce })).toString('base64url')
    setCookie(c, 'mice_oidc_pkce', pkceCookie, {
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
      path: '/',
      maxAge: 600,
    })
    
    // In a real flow, user would be redirected to IdP
    return c.redirect(`https://test-idp.example.com/authorize?state=${state}`)
  })
  
  // /auth/callback - handles OAuth callback
  bff.get('/auth/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    
    if (!code || !state) {
      return c.html('<p>Missing code or state</p>', 400)
    }
    
    const pkceCookie = getCookie(c, 'mice_oidc_pkce')
    if (!pkceCookie) {
      return c.html('<p>Missing PKCE cookie</p>', 400)
    }
    
    let pkce: PkceState
    try {
      pkce = JSON.parse(Buffer.from(pkceCookie, 'base64url').toString('utf8'))
    } catch {
      return c.html('<p>Invalid PKCE cookie</p>', 400)
    }
    
    if (pkce.state !== state) {
      return c.html('<p>State mismatch</p>', 400)
    }
    
    // Check expiry: 10 minutes
    const storedState = pkceStates.get(state)
    if (!storedState) {
      return c.html('<p>Invalid or expired login state</p>', 400)
    }
    
    const age = clock.now() - storedState.createdAt
    if (age > 10 * 60 * 1000) {
      pkceStates.delete(state)
      return c.html('<p>Login state expired</p>', 400)
    }
    
    // Exchange code for user identity
    const codeData = issuedCodes.get(code)
    if (!codeData || codeData.state !== state) {
      return c.html('<p>Invalid authorization code</p>', 400)
    }
    
    const user = options.users.find(u => u.sub === codeData.sub)
    if (!user) {
      return c.html('<p>User not found</p>', 400)
    }
    
    // Create session user
    const sessionUser: SessionUser = {
      sub: user.sub,
      iss: 'https://test-idp.example.com',
      email: user.email,
      name: user.name,
    }
    
    // Seal and set session cookie
    const sessionToken = await sealTestSession(sessionUser)
    setCookie(c, '__Host-Session', sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })
    
    // Clean up
    pkceStates.delete(state)
    issuedCodes.delete(code)
    
    return c.redirect('/')
  })
  
  // /auth/me - returns the current user
  bff.get('/auth/me', async (c) => {
    const sessionCookie = getCookie(c, '__Host-Session')
    if (!sessionCookie) {
      return c.json({ error: 'Not authenticated' }, 401)
    }
    
    // Decode the session to get user info
    try {
      const { payload } = await jwtDecrypt(sessionCookie, testSecretKey())
      
      return c.json({
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
      })
    } catch (error) {
      return c.json({ error: 'Invalid session' }, 401)
    }
  })
  
  return {
    idp,
    clock,
    bff,
    issueAuthCode(sub: string, state: string): string {
      const code = `code_${Math.random().toString(36).slice(2)}`
      issuedCodes.set(code, { sub, state })
      return code
    },
  }
}
