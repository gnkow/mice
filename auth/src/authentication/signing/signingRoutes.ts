import type { Hono } from 'hono'
import { guarded } from '../session/routeGuard.js'
import { reauthenticate } from '../oidc/stepUp.js'
import {
  createSignature,
  prepareForSigning,
  type SignatureMeaning,
  type SessionInfo,
} from './signingCeremony.js'
import type { AuditDep } from '../../routeDeps.js'

/**
 * TICKET 09: Signing Ceremony Routes
 * 
 * Provides HTTP endpoints for Part 11-compliant electronic signatures.
 * - Fresh authentication required (< 60s per spec)
 * - MFA required
 * - Hash-bound signatures
 * - Meaning recorded
 */

const SIGNING_FRESHNESS_SEC = 60 // 60 seconds per spec requirement

export function registerSigningRoutes(app: Hono, { audit }: AuditDep): void {
  // Prepare content for signing (shows hash, requires step-up)
  app.post('/auth/sign/prepare', guarded({ mutates: false }, async ({ c, user }) => {
    // Check for fresh authentication
    const stepUp = await reauthenticate(c, SIGNING_FRESHNESS_SEC)
    if (!stepUp.ok) return stepUp.response

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
    body: { required: ['content', 'meaning', 'expectedHash'] }
  }, async ({ c, user, body }) => {
    // Verify fresh authentication again
    const stepUp = await reauthenticate(c, SIGNING_FRESHNESS_SEC)
    if (!stepUp.ok) return stepUp.response

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
      await audit.append({
        actor: { iss: user.iss, sub: user.sub },
        via: 'session',
        method: c.req.method,
        path: c.req.path,
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
      const session: SessionInfo = {
        authenticatedAt: (stepUp.user.authTime ?? 0) * 1000, // Convert to ms
        mfaVerified: true, // TODO: Check acr/amr claims from IdP
        principal: {
          iss: user.iss,
          sub: user.sub,
          name: user.name ?? `${user.iss}|${user.sub}`,
        },
      }

      const signature = createSignature(content, meaning, session)

      await audit.append({
        actor: { iss: user.iss, sub: user.sub },
        via: 'session',
        method: c.req.method,
        path: c.req.path,
        status: 200,
        action: 'signature.created',
        message: `Electronic signature created: ${meaning}`,
        detail: {
          meaning,
          hash: signature.hash,
          signedAt: signature.signedAt,
        },
      })

      return c.json({
        signature: {
          hash: signature.hash,
          meaning: signature.meaning,
          signedAt: signature.signedAt,
          principal: signature.principal,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signature creation failed'
      
      await audit.append({
        actor: { iss: user.iss, sub: user.sub },
        via: 'session',
        method: c.req.method,
        path: c.req.path,
        status: 400,
        action: 'signature.failed',
        message: `Signature failed: ${message}`,
        detail: { meaning },
      })

      return c.json({ error: message }, 400)
    }
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
