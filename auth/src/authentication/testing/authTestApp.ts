import { createFakeIdp, type FakeIdp } from './fakeIdp.js'

export interface AuthTestAppOptions {
  users: Array<{ sub: string; email: string; name: string }>
}

export interface AuthTestApp {
  idp: FakeIdp
}

export function createAuthTestApp(options: AuthTestAppOptions): AuthTestApp {
  const idp = createFakeIdp(options.users)
  
  return {
    idp,
  }
}
