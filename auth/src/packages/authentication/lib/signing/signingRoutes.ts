import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import {
  buildSigningSessionInfo,
  createSignature,
  prepareForSigning,
  signatureEvidenceFields,
  type SignatureMeaning,
} from './signingCeremony.js'
import { verifySigningEvidence } from './signingEvidence.js'
import { verifyIdpJwt } from '../oidc/oidc.js'
import { signatureStore } from './signatureStore.js'
import { isSigningBlockedByDrift } from '../compliance/idpDriftDetection.js'
import type { AuditDep } from '../../../shared/index.js'
import { confirmPrivilegedGroups } from '../access/privilegedGroups.js'
import type { SessionUser } from '../session/session.js'
import {
  allocateChangeControlId,
  DuplicateChangeControlIdError,
  isValidChangeControlId,
  normalizeChangeControlId,
} from '../../../merge/index.js'
import { prepareMutationDocument } from '../../../merge/index.js'
import { requireSigningAccess, SIGNING_STEP_UP_MAX_AGE_SEC } from './signingAccess.js'

/**
 * Signing Ceremony Routes - Authentication Domain
 * 
 * Provides HTTP endpoints for the authentication layer of electronic signatures.
 * These are generic signing primitives, not the full GxP merge-approval workflow.
 * 
 * Authentication concerns (this module):
 * - Fresh authentication enforcement (< 60s)
 * - MFA validation
 * - Hash-bound signatures
 * - Tamper detection
 * 
 * GxP concerns (04-gxp-compliance):
 * - Merge approval workflow integration
 * - Signature storage in immudb
 * - Self-approval prevention
 * - Signature revocation
 * - Bulk approval ceremonies
 * 
 * Related tickets:
 * - .scratch/authentication/issues/09-step-up-reauthentication.md
 * - .scratch/gxp-compliance/issues/05-sign-validated-branch-merge.md
 */

let verifyJwt: (token: string) => Promise<Record<string, unknown>> = verifyIdpJwt

/** Replaces the id_token verifier so route tests need no live IdP keys. */
export function setSigningJwtVerifierForTests(next: typeof verifyJwt): void {
  verifyJwt = next
}

async function directoryFailure(user: SessionUser): Promise<Response | null> {
  try {
    await confirmPrivilegedGroups(user)
    return null
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return Response.json({ error: 'Directory unavailable' }, { status: 503 })
    }
    throw err
  }
}

export function registerSigningRoutes(app: Hono, { audit }: AuditDep): void {
  // Prepare a regulated mutation for signing (canonical document + hash).
  app.post('/auth/sign/prepare-mutation', guarded({
    mutates: false,
    body: { required: ['method', 'path', 'reason'] },
  }, async ({ c, user, body }) => {
    const unavailable = await directoryFailure(user)
    if (unavailable) return unavailable
    const access = await requireSigningAccess(c, user)
    if (!access.ok) return access.response

    const method = String(body.method)
    const path = String(body.path)
    const reason = String(body.reason)
    if (!reason.trim()) {
      return c.json({ error: 'Reason required', code: 'reason_required' }, 400)
    }

    const prepared = prepareMutationDocument({
      method,
      path,
      reason,
      body: body.body,
    })

    return c.json({
      content: prepared.content,
      hash: prepared.hash,
      action: prepared.action,
      meaning: 'Approved' as const,
      principal: {
        iss: user.iss,
        sub: user.sub,
        name: user.name ?? `${user.iss}|${user.sub}`,
      },
      preparedAt: Date.now(),
    })
  }))

  // Prepare content for signing (shows hash, requires step-up)
  app.post('/auth/sign/prepare', guarded({ mutates: false }, async ({ c, user }) => {
    const unavailable = await directoryFailure(user)
    if (unavailable) return unavailable
    const access = await requireSigningAccess(c, user)
    if (!access.ok) return access.response

    const body = await c.req.json()
    const content = String(body.content ?? '')
    
    if (!content.trim()) {
      return c.json({ error: 'Content required for signing' }, 400)
    }

    const prepared = prepareForSigning(content)
    
    return c.json({
      content: prepared.content,
      hash: prepared.hash,
      principal: {
        iss: user.iss,
        sub: user.sub,
        name: user.name ?? `${user.iss}|${user.sub}`,
      },
      preparedAt: Date.now(),
    })
  }))

  // Execute signature ceremony
  app.post('/auth/sign/execute', guarded({
    mutates: true,
    action: 'esign.execute',
    body: { required: ['content', 'meaning', 'expectedHash'] }
  }, async ({ c, user, body, audit: writeOutcome }) => {
    const unavailable = await directoryFailure(user)
    if (unavailable) return unavailable
    // Ticket 23: Check for critical IdP drift before signing
    const driftCheck = await isSigningBlockedByDrift()
    if (driftCheck.blocked) {
      await writeOutcome({
        status: 503,
        action: 'signature.blocked_by_drift',
        message: 'Signature blocked: critical IdP drift detected',
        detail: { reason: driftCheck.reason, reportId: driftCheck.reportId },
      })
      return c.json({
        error: 'Signing blocked due to critical IdP configuration drift',
        detail: driftCheck.reason,
        reportId: driftCheck.reportId,
      }, 503)
    }

    const access = await requireSigningAccess(c, user)
    if (!access.ok) return access.response

    const content = String(body.content)
    const meaning = String(body.meaning) as SignatureMeaning
    const expectedHash = String(body.expectedHash)

    // Validate meaning
    if (!['Authored', 'Reviewed', 'Approved'].includes(meaning)) {
      return c.json({ error: 'Invalid signature meaning' }, 400)
    }

    // Verify hash hasn't changed
    const prepared = prepareForSigning(content)
    if (prepared.hash !== expectedHash) {
      await writeOutcome({
        status: 400,
        action: 'signature.hash_mismatch',
        message: 'Signature rejected: content changed after display',
        detail: { meaning, expectedHash, actualHash: prepared.hash },
      })
      return c.json({ 
        error: 'Content changed after display; signature invalidated',
        expectedHash,
        actualHash: prepared.hash,
      }, 400)
    }

    try {
      // Ticket 26: Extract MFA evidence AND verification metadata from id_token
      // Ticket 52: the step-up token is re-verified now; missing or stale claims refuse.
      const evidence = access.user.idToken
        ? await verifySigningEvidence(access.user.idToken, {
            verifyJwt,
            nowSec: Math.floor(Date.now() / 1000),
            maxAgeSec: SIGNING_STEP_UP_MAX_AGE_SEC,
          })
        : ({ ok: false, reason: 'unverifiable', detail: 'no id_token in session' } as const)

      // Refuse signing without verified MFA evidence (Part 11 §11.200 requirement)
      if (!evidence.ok) {
        await writeOutcome({
          status: 403,
          action: 'signature.mfa_required',
          message: 'Electronic signature requires verified MFA evidence',
          detail: { reason: evidence.reason, ...(evidence.detail ? { error: evidence.detail } : {}) },
        })
        return c.json({ error: 'MFA required for electronic signature', reason: evidence.reason }, 403)
      }

      const session = buildSigningSessionInfo(
        {
          iss: user.iss,
          sub: user.sub,
          name: user.name ?? `${user.iss}|${user.sub}`,
        },
        evidence,
      )

      const signature = createSignature(content, meaning, session)
      const rawCc =
        typeof body.changeControlId === 'string' && body.changeControlId.trim()
          ? body.changeControlId.trim()
          : typeof body.change_control_id === 'string' && body.change_control_id.trim()
            ? body.change_control_id.trim()
            : ''
      const changeControlId = rawCc || allocateChangeControlId()
      if (!isValidChangeControlId(normalizeChangeControlId(changeControlId))) {
        return c.json(
          {
            error: 'Change-control id must be 3–128 characters (letters, digits, . _ / -)',
            code: 'change_control_id_invalid',
          },
          400,
        )
      }
      // Optional merge-result binding (gxp/06 signing ceremony UI → complete signed merge).
      const rawBinding = body.binding
      const binding =
        rawBinding && typeof rawBinding === 'object' && !Array.isArray(rawBinding)
          ? (() => {
              const b = rawBinding as Record<string, unknown>
              const repo = typeof b.repo === 'string' ? b.repo.trim() : ''
              const sourceHead = typeof b.sourceHead === 'string' ? b.sourceHead.trim() : ''
              const targetHead = typeof b.targetHead === 'string' ? b.targetHead.trim() : ''
              const manifestDigest =
                typeof b.manifestDigest === 'string' ? b.manifestDigest.trim() : ''
              if (!repo || !sourceHead || !targetHead || !manifestDigest) return undefined
              return { repo, sourceHead, targetHead, manifestDigest }
            })()
          : undefined
      if (binding && binding.manifestDigest !== signature.hash) {
        return c.json(
          {
            error: 'Binding manifest digest must match the signed content hash',
            expectedHash: signature.hash,
            actualHash: binding.manifestDigest,
          },
          400,
        )
      }
      const manifest =
        typeof body.manifest === 'string'
          ? body.manifest
          : binding
            ? content
            : undefined
      let saved: { id: string; seq: number }
      try {
        saved = await (await signatureStore()).record({
          signer: signature.principal,
          meaning,
          contentHash: signature.hash,
          changeControlId,
          ...(binding ? { binding } : {}),
          ...(manifest !== undefined ? { manifest } : {}),
          ...signatureEvidenceFields(signature),
        })
      } catch (err) {
        if (err instanceof DuplicateChangeControlIdError) {
          return c.json(
            {
              error: 'This change-control id was already used',
              code: err.code,
              changeControlId: err.changeControlId,
            },
            409,
          )
        }
        const reason = err instanceof Error ? err.message : 'signature record unavailable'
        await writeOutcome({
          status: 503,
          action: 'esign.failed',
          message: `Signature not recorded: ${reason}`,
          detail: { meaning, hash: signature.hash },
        })
        return c.json({ error: 'Signature could not be recorded' }, 503)
      }

      // Ceremony Outcome names esign.execute; consuming mutations still carry signature_id evidence.
      await writeOutcome({
        status: 200,
        action: 'esign.execute',
        message: 'Electronic signature ceremony completed',
        detail: {
          signatureId: saved.id,
          meaning,
          hash: signature.hash,
          changeControlId,
        },
      })
      return c.json({
        signature: {
          id: saved.id,
          hash: signature.hash,
          meaning: signature.meaning,
          signedAt: signature.signedAt,
          changeControlId,
          principal: signature.principal,
          ...signatureEvidenceFields(signature),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signature creation failed'
      
      await writeOutcome({
        status: 400,
        action: 'esign.failed',
        message: `Signature failed: ${message}`,
        detail: { meaning },
      })

      return c.json({ error: message }, 400)
    }
  }))

  // Authoritative record + verification proof (append-only; no edit/delete routes).
  app.get('/auth/sign/:id/proof', guarded({ mutates: false }, async ({ c, user }) => {
    const unavailable = await directoryFailure(user)
    if (unavailable) return unavailable
    const access = await requireSigningAccess(c, user)
    if (!access.ok) return access.response

    const id = c.req.param('id')
    const proof = await (await signatureStore()).proof(id)
    if (!proof) return c.json({ error: 'Not found' }, 404)
    return c.json({ id, proof })
  }))

  app.get('/auth/sign/:id', guarded({ mutates: false }, async ({ c, user }) => {
    const unavailable = await directoryFailure(user)
    if (unavailable) return unavailable
    const access = await requireSigningAccess(c, user)
    if (!access.ok) return access.response

    const id = c.req.param('id')
    const found = await (await signatureStore()).get(id)
    if (!found) return c.json({ error: 'Not found' }, 404)
    return c.json({ id, seq: found.seq, record: found.record })
  }))

  // Demo page for signing ceremony
  app.get('/auth/sign/demo', guarded({ mutates: false }, async ({ c, user }) => {
    return c.html(`
<!DOCTYPE html>
<html>
<head>
  <title>Electronic Signature Demo</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    .section { margin: 2rem 0; padding: 1rem; border: 1px solid #ddd; border-radius: 4px; }
    label { display: block; margin: 0.5rem 0; font-weight: bold; }
    textarea, select, button { font-family: inherit; font-size: inherit; }
    textarea { width: 100%; height: 150px; padding: 0.5rem; }
    button { padding: 0.5rem 1rem; margin: 0.5rem 0.5rem 0 0; cursor: pointer; }
    .hash { font-family: monospace; font-size: 0.9em; word-break: break-all; background: #f5f5f5; padding: 0.5rem; }
    .error { color: #c00; }
    .success { color: #080; }
  </style>
</head>
<body>
  <h1>Electronic Signature Demo</h1>
  <p>Signed in as: <strong>${user.name ?? user.sub}</strong></p>
  
  <div class="section">
    <h2>Step 1: Prepare Content for Signing</h2>
    <label>Content to sign:</label>
    <textarea id="content" placeholder="Enter the content you want to sign...">Sample record: Batch XYZ-123 released for distribution on 2026-10-26.</textarea>
    <button onclick="prepare()">Prepare for Signature</button>
    <div id="prepare-result"></div>
  </div>

  <div class="section">
    <h2>Step 2: Execute Signature</h2>
    <label>Signature meaning:</label>
    <select id="meaning">
      <option value="Authored">Authored</option>
      <option value="Reviewed">Reviewed</option>
      <option value="Approved">Approved</option>
    </select>
    <button onclick="sign()" disabled id="sign-btn">Sign Content</button>
    <div id="sign-result"></div>
  </div>

  <script>
    let preparedHash = null;
    let preparedContent = null;

    async function prepare() {
      const content = document.getElementById('content').value;
      const result = document.getElementById('prepare-result');
      result.innerHTML = '<p>Preparing...</p>';

      try {
        const res = await fetch('/auth/sign/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });

        if (res.ok) {
          const data = await res.json();
          preparedHash = data.hash;
          preparedContent = data.content;
          
          result.innerHTML = \`
            <p class="success">✓ Ready for signature</p>
            <p><strong>Content hash (SHA-256):</strong></p>
            <div class="hash">\${data.hash}</div>
            <p><em>Review the content and hash before signing.</em></p>
          \`;
          document.getElementById('sign-btn').disabled = false;
        } else if (res.status === 401) {
          const data = await res.json();
          if (data.reauthUrl) {
            result.innerHTML = '<p class="error">Fresh authentication required. <a href="' + data.reauthUrl + '">Re-authenticate now</a></p>';
          } else {
            result.innerHTML = '<p class="error">Authentication required.</p>';
          }
        } else {
          const data = await res.json();
          result.innerHTML = '<p class="error">Error: ' + (data.error || 'Failed to prepare') + '</p>';
        }
      } catch (err) {
        result.innerHTML = '<p class="error">Network error: ' + err.message + '</p>';
      }
    }

    async function sign() {
      if (!preparedHash || !preparedContent) {
        alert('Please prepare content first');
        return;
      }

      const meaning = document.getElementById('meaning').value;
      const result = document.getElementById('sign-result');
      result.innerHTML = '<p>Signing...</p>';

      try {
        const res = await fetch('/auth/sign/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: preparedContent,
            meaning: meaning,
            expectedHash: preparedHash
          })
        });

        if (res.ok) {
          const data = await res.json();
          const sig = data.signature;
          const date = new Date(sig.signedAt).toISOString();
          
          result.innerHTML = \`
            <p class="success">✓ Signature created successfully!</p>
            <p><strong>Meaning:</strong> \${sig.meaning}</p>
            <p><strong>Signed by:</strong> \${sig.principal.name}</p>
            <p><strong>Signed at:</strong> \${date}</p>
            <p><strong>Hash:</strong></p>
            <div class="hash">\${sig.hash}</div>
          \`;
          
          // Reset
          preparedHash = null;
          preparedContent = null;
          document.getElementById('sign-btn').disabled = true;
        } else if (res.status === 401) {
          const data = await res.json();
          if (data.reauthUrl) {
            result.innerHTML = '<p class="error">Fresh authentication required. <a href="' + data.reauthUrl + '">Re-authenticate now</a></p>';
          } else {
            result.innerHTML = '<p class="error">Authentication required.</p>';
          }
        } else {
          const data = await res.json();
          result.innerHTML = '<p class="error">Error: ' + (data.error || 'Signature failed') + '</p>';
          if (data.actualHash && data.expectedHash !== data.actualHash) {
            result.innerHTML += '<p class="error">The content was modified after preparation. Please prepare again.</p>';
            preparedHash = null;
            preparedContent = null;
            document.getElementById('sign-btn').disabled = true;
          }
        }
      } catch (err) {
        result.innerHTML = '<p class="error">Network error: ' + err.message + '</p>';
      }
    }
  </script>
</body>
</html>
    `)
  }))
}
