import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripIdentityTrailers,
  appendIdentityTrailer,
  formatIdentityTrailer,
  createJobToken,
  isJobToken,
  appendJobAttribution,
  canElectronicallySign,
  requireSigningCapability,
} from './commitIdentity.js'
import { SERVICE_ISSUER } from '../session/principal.js'

/**
 * TICKET 08: Commit Identity and Job Tokens
 * 
 * Requirements:
 * - Strip client-supplied identity trailers from commits
 * - BFF appends iss+sub + name snapshot to every commit
 * - Jobs get BFF-internal tokens (not user credentials)
 * - Actions attributed to submitter with "performed by Job" marker
 * - Only humans can electronically sign
 */

describe('Commit Identity - Strip Client Trailers', () => {
  it('strips identity trailers from client-supplied commits', () => {
    const message = 'Fix bug\n\nPerformed-by: urn:mice:service|evil'
    const cleaned = stripIdentityTrailers(message)
    assert.equal(cleaned, 'Fix bug\n')
    assert.ok(!cleaned.includes('Performed-by'))
  })

  it('strips multiple identity trailers', () => {
    const message = 'Fix bug\n\nPerformed-by: foo\nSubmitted-by: bar'
    const cleaned = stripIdentityTrailers(message)
    assert.equal(cleaned, 'Fix bug\n')
    assert.ok(!cleaned.includes('Performed-by'))
    assert.ok(!cleaned.includes('Submitted-by'))
  })

  it('preserves non-identity trailers', () => {
    const message = 'Fix bug\n\nReviewed-by: Bob\nTested: yes'
    const cleaned = stripIdentityTrailers(message)
    assert.ok(cleaned.includes('Reviewed-by: Bob'))
    assert.ok(cleaned.includes('Tested: yes'))
  })
})

describe('Commit Identity - BFF Appends Identity', () => {
  it('appends iss+sub to every commit', () => {
    const message = 'Fix bug'
    const user = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendIdentityTrailer(message, 'Submitted-by', user)
    assert.ok(result.includes('https://idp.example.com|alice123'))
  })

  it('appends name snapshot at commit time', () => {
    const message = 'Fix bug'
    const user = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendIdentityTrailer(message, 'Submitted-by', user)
    assert.ok(result.includes('Alice Smith'))
  })

  it('formats identity trailer correctly', () => {
    const user = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const formatted = formatIdentityTrailer(user)
    assert.equal(formatted, 'https://idp.example.com|alice123 (Alice Smith)')
  })
})

describe('Job Tokens - BFF Internal Credentials', () => {
  it('creates BFF-internal token for job execution', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token = createJobToken('job-123', submittedBy)
    assert.equal(token.kind, 'job')
    assert.equal(token.jobId, 'job-123')
    assert.deepEqual(token.submittedBy, submittedBy)
  })

  it('job token does not contain user credentials', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token = createJobToken('job-123', submittedBy)
    // Job token identifies the job, not the user's session
    assert.equal(token.kind, 'job')
    assert.notEqual(token.kind, 'user')
  })

  it('job token is scoped to job execution only', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token = createJobToken('job-456', submittedBy, 1000)
    assert.ok(isJobToken(token))
    assert.ok(token.expiresAt > token.issuedAt)
  })
})

describe('Job Actions - Attribution with Marker', () => {
  it('attributes action to submitter with "performed by Job" marker', () => {
    const message = 'Fix bug'
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendJobAttribution(message, 'job-123', submittedBy)
    assert.ok(result.includes('Submitted-by: https://idp.example.com|alice123 (Alice Smith)'))
    assert.ok(result.includes('Performed-by: Job job-123'))
  })

  it('includes job ID in performed-by marker', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendJobAttribution('Task', 'job-456', submittedBy)
    assert.ok(result.includes('Job job-456'))
  })
})

describe('Electronic Signatures - Human Only', () => {
  it('allows humans to electronically sign', () => {
    const user = { iss: 'https://idp.example.com', sub: 'alice123' }
    assert.ok(canElectronicallySign(user))
    assert.doesNotThrow(() => requireSigningCapability(user))
  })

  it('rejects electronic signature from service principal', () => {
    const servicePrincipal = { iss: SERVICE_ISSUER, sub: 'sp-123' }
    assert.equal(canElectronicallySign(servicePrincipal), false)
    assert.throws(
      () => requireSigningCapability(servicePrincipal),
      /Only human principals can electronically sign/
    )
  })

  it('rejects electronic signature from job', () => {
    const job = { iss: SERVICE_ISSUER, sub: 'job-123' }
    assert.equal(canElectronicallySign(job), false)
    assert.throws(
      () => requireSigningCapability(job),
      /Only human principals can electronically sign/
    )
  })
})
