import { fakeClock, type FakeClock } from '../../clock.js'
import { createFakeIdp, type FakeIdp } from './fakeIdp.js'

export interface AuthTestAppOptions {
  users: Array<{ sub: string; email: string; name: string }>
}

export interface AuthTestApp {
  idp: FakeIdp
  clock: FakeClock
}

export function createAuthTestApp(options: AuthTestAppOptions): AuthTestApp {
  const clock = fakeClock()
  const idp = createFakeIdp(options.users, clock)
  
  return {
    idp,
    clock,
  }
}
