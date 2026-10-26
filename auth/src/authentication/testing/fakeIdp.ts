import { SignJWT, jwtVerify } from 'jose'
import type { Clock } from '../../clock.js'

export interface FakeIdpUser {
  sub: string
  email: string
  name: string
}

export interface FakeIdpClaims {
  sub: string
  email: string
  name: string
  iss: string
  aud: string
  iat: number
  exp: number
}

export interface FakeIdp {
  issueToken(sub: string): Promise<string>
  decodeToken(token: string): Promise<FakeIdpClaims>
}

// Simple symmetric key for testing
const SECRET_KEY = new TextEncoder().encode('test-secret-key-for-fake-idp-do-not-use-in-prod')

export function createFakeIdp(users: FakeIdpUser[], clock: Clock): FakeIdp {
  const userMap = new Map(users.map(u => [u.sub, u]))
  const issuer = 'https://test-idp.example.com'
  const audience = 'test-audience'
  
  return {
    async issueToken(sub: string): Promise<string> {
      const user = userMap.get(sub)
      if (!user) {
        throw new Error(`User ${sub} not found`)
      }
      
      const now = Math.floor(clock.now() / 1000)
      
      const token = await new SignJWT({
        sub: user.sub,
        email: user.email,
        name: user.name,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(now)
        .setExpirationTime(now + 3600) // 1 hour
        .sign(SECRET_KEY)
      
      return token
    },
    
    async decodeToken(token: string): Promise<FakeIdpClaims> {
      // Skip expiration check for test tokens (use 100 years tolerance)
      const { payload } = await jwtVerify(token, SECRET_KEY, {
        issuer,
        audience,
        clockTolerance: 100 * 365 * 24 * 60 * 60, // 100 years in seconds
      })
      
      return {
        sub: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        iss: payload.iss as string,
        aud: payload.aud as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
      }
    },
  }
}
