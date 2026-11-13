import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { signatureEvidenceRows } from './signatureEvidence.js'

describe('signature evidence rows (#13 auditor view + #53 identity)', () => {
  it('labels MFA and verification evidence from a esign.created detail', () => {
    const rows = signatureEvidenceRows('esign.created', {
      mfaEvidence: { hasMfa: true, acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_700_000_000 },
      verificationMetadata: { jwks_key_id: 'kid-1', token_verified_at: 1_767_225_600_000, idp_issuer: 'https://idp.test' },
    })
    assert.deepEqual(rows, [
      { label: 'Auth context (acr)', value: 'mfa' },
      { label: 'Auth methods (amr)', value: 'pwd, otp' },
      { label: 'Authenticated at', value: '2023-11-14T22:13:20.000Z' },
      { label: 'JWKS key id', value: 'kid-1' },
      { label: 'Verified at', value: '2026-01-01T00:00:00.000Z' },
      { label: 'Issuer', value: 'https://idp.test' },
    ])
  })

  it('includes the signed snapshot and now-known-as when present', () => {
    const rows = signatureEvidenceRows('esign.created', {
      signedAt: '2021-03-15T12:00:00.000Z',
      signer: { iss: 'https://idp.test', sub: 'jane', name: 'Dr. Jane Smith' },
      nowKnownAs: 'Dr. Jane Jones',
      mfaEvidence: { acr: 'mfa', amr: ['pwd'] },
    })
    assert.deepEqual(
      rows.filter((r) =>
        ['Signed name', 'Issuer (iss)', 'Subject (sub)', 'Signed at', 'Now known as'].includes(
          r.label,
        ),
      ),
      [
        { label: 'Signed name', value: 'Dr. Jane Smith' },
        { label: 'Issuer (iss)', value: 'https://idp.test' },
        { label: 'Subject (sub)', value: 'jane' },
        { label: 'Signed at', value: '2021-03-15T12:00:00.000Z' },
        { label: 'Now known as', value: 'Dr. Jane Jones' },
      ],
    )
  })

  it('returns no rows for other actions or when evidence is absent', () => {
    assert.deepEqual(signatureEvidenceRows('file.write', { mfaEvidence: { acr: 'mfa', amr: [] } }), [])
    assert.deepEqual(signatureEvidenceRows('esign.created', undefined), [])
  })
})
