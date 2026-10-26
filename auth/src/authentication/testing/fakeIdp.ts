import type { Clock } from '../../clock.js'

export interface FakeIdpUser {
  sub: string
  email: string
  name: string
}

export interface FakeIdp {
  issueToken(sub: string): Promise<string>
}

export function createFakeIdp(users: FakeIdpUser[], clock: Clock): FakeIdp {
  const userMap = new Map(users.map(u => [u.sub, u]))
  
  return {
    async issueToken(sub: string): Promise<string> {
      const user = userMap.get(sub)
      if (!user) {
        throw new Error(`User ${sub} not found`)
      }
      // Minimal JWT-like token (just enough to pass the test)
      // Clock is available for future use in token generation
      return `fake-token-for-${sub}`
    },
  }
}
