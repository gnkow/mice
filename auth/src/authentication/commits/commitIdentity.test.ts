import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  humanCommitAuthor,
  humanCommitEmail,
  stripIdentityTrailers,
  appendIdentityTrailer,
  formatIdentityTrailer,
  createJobToken,
  isJobToken,
  appendJobAttribution,
  appendJobAttributionFromToken,
  hashJobToken,
  canElectronicallySign,
  requireSigningCapability,
} from './commitIdentity.js'

/**
 * TICKET 08 & 21: Commit Identity and Job Tokens
 * 
 * Requirements:
 * - Strip client-supplied identity trailers from commits
 * - BFF appends iss+sub + name snapshot to every commit
 * - Jobs get BFF-internal tokens (not user credentials)
 * - Job commits carry attribution trailer: Job ID + Submitted-by + Token hash
 * - Human commits have iss|sub trailer only (no Job marker)
 * - Only humans can electronically sign
 */

describe('Human commit author (Ticket 08)', () => {
  it('formats author as canonical iss|sub', () => {
    assert.equal(
      humanCommitAuthor({ iss: 'https://idp.example.com', sub: 'alice123' }),
      'https://idp.example.com|alice123',
    )
  })

  it('strips a trailing slash on iss', () => {
    assert.equal(
      humanCommitAuthor({ iss: 'https://idp.example.com/', sub: 'alice123' }),
      'https://idp.example.com|alice123',
    )
  })

  it('snapshots email at commit time', () => {
    assert.equal(
      humanCommitEmail({ email: 'alice@example.com' }),
      'alice@example.com',
    )
  })
})

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

describe('Job Actions - Attribution with Trailer (Ticket 21, U6)', () => {
  it('includes job ID, submitter, and token hash in single trailer', () => {
    const message = 'Add data processing results'
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token = createJobToken('J-1234', submittedBy)
    const tokenHash = hashJobToken(token)
    const result = appendJobAttribution(message, 'J-1234', submittedBy, tokenHash)
    
    assert.ok(result.includes('Job: J-1234'))
    assert.ok(result.includes('Submitted-by: https://idp.example.com|alice123 (Alice Smith)'))
    assert.ok(result.includes(`Token: sha256:${tokenHash}`))
  })

  it('formats job trailer on single line', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendJobAttribution('Task', 'J-456', submittedBy, 'abc123def456')
    
    // Check that Job, Submitted-by, and Token are on the same line
    const lines = result.split('\n')
    const trailerLine = lines.find(line => line.startsWith('Job:'))
    assert.ok(trailerLine)
    assert.ok(trailerLine.includes('Job: J-456'))
    assert.ok(trailerLine.includes('Submitted-by:'))
    assert.ok(trailerLine.includes('Token: sha256:abc123def456'))
  })

  it('works without token hash (backward compatibility)', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendJobAttribution('Task', 'J-789', submittedBy)
    
    assert.ok(result.includes('Job: J-789'))
    assert.ok(result.includes('Submitted-by: https://idp.example.com|alice123 (Alice Smith)'))
    assert.ok(!result.includes('Token:'))
  })

  it('convenience wrapper extracts from JobToken', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token = createJobToken('J-999', submittedBy)
    const result = appendJobAttributionFromToken('Process data', token)
    
    assert.ok(result.includes('Job: J-999'))
    assert.ok(result.includes('Submitted-by: https://idp.example.com|alice123 (Alice Smith)'))
    assert.ok(result.includes('Token: sha256:'))
  })

  it('hash is deterministic for same token', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token = createJobToken('J-100', submittedBy)
    const hash1 = hashJobToken(token)
    const hash2 = hashJobToken(token)
    assert.equal(hash1, hash2)
  })

  it('hash is different for different tokens', () => {
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const token1 = createJobToken('J-100', submittedBy)
    const token2 = createJobToken('J-200', submittedBy)
    const hash1 = hashJobToken(token1)
    const hash2 = hashJobToken(token2)
    assert.notEqual(hash1, hash2)
  })

  it('strips client-supplied job trailers before adding authoritative one', () => {
    const message = 'Fix\n\nJob: J-evil, Submitted-by: attacker, Token: fake'
    const submittedBy = { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice Smith' }
    const result = appendJobAttribution(message, 'J-real', submittedBy, 'realhash')
    
    // Should contain only the authoritative trailer
    const jobMatches = result.match(/Job: J-/g)
    assert.equal(jobMatches?.length, 1, 'Should have exactly one Job trailer')
    assert.ok(result.includes('Job: J-real'))
    assert.ok(!result.includes('J-evil'))
  })
})

describe('Electronic Signatures - Human Only', () => {
  it('allows humans to electronically sign', () => {
    const user = { iss: 'https://idp.example.com', sub: 'alice123' }
    assert.ok(canElectronicallySign(user))
    assert.doesNotThrow(() => requireSigningCapability(user))
  })

})
