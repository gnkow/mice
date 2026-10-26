export interface FakeIdpUser {
  sub: string
  email: string
  name: string
}

export interface FakeIdp {
  issueToken(sub: string): Promise<string>
}

export function createFakeIdp(users: FakeIdpUser[]): FakeIdp {
  throw new Error('Not implemented')
}
