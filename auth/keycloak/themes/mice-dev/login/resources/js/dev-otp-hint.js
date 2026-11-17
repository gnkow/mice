/**
 * Local-dev helper: show the current shared TOTP next to Keycloak's OTP input.
 * Secret must match auth/keycloak/realm-mice.json (UTF-8 key material, not base32).
 */
;(function () {
  const DEV_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'
  const PERIOD_SEC = 30

  function findOtpInput() {
    return (
      document.querySelector('#otp') ||
      document.querySelector('input[name="otp"]') ||
      document.querySelector('input[autocomplete="one-time-code"]')
    )
  }

  async function totpCode(secret, atMs) {
    const keyBytes = new TextEncoder().encode(secret)
    const counter = Math.floor(atMs / 1000 / PERIOD_SEC)
    const msg = new ArrayBuffer(8)
    new DataView(msg).setBigUint64(0, BigInt(counter))
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    )
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg))
    const offset = digest[digest.length - 1] & 0xf
    const code =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)
    return String(code % 1_000_000).padStart(6, '0')
  }

  function ensureHint(input) {
    let hint = document.getElementById('mice-dev-otp-hint')
    if (hint) return hint
    hint = document.createElement('div')
    hint.id = 'mice-dev-otp-hint'
    hint.className = 'mice-dev-otp-hint'
    hint.setAttribute('aria-live', 'polite')
    hint.innerHTML =
      '<span class="mice-dev-otp-hint__label">Dev OTP</span>' +
      '<code class="mice-dev-otp-hint__code" id="mice-dev-otp-code">······</code>' +
      '<span class="mice-dev-otp-hint__ttl" id="mice-dev-otp-ttl"></span>'
    const host =
      input.closest('.pf-v5-c-form__group') ||
      input.closest('.form-group') ||
      input.parentElement
    if (host) host.appendChild(hint)
    else input.insertAdjacentElement('afterend', hint)
    return hint
  }

  async function tick(input) {
    ensureHint(input)
    const now = Date.now()
    const codeEl = document.getElementById('mice-dev-otp-code')
    const ttlEl = document.getElementById('mice-dev-otp-ttl')
    if (!codeEl || !ttlEl) return
    try {
      codeEl.textContent = await totpCode(DEV_TOTP_SECRET, now)
      const left = PERIOD_SEC - (Math.floor(now / 1000) % PERIOD_SEC)
      ttlEl.textContent = `(${left}s)`
    } catch {
      codeEl.textContent = 'error'
      ttlEl.textContent = ''
    }
  }

  function start() {
    const input = findOtpInput()
    if (!input) return
    void tick(input)
    window.setInterval(() => void tick(input), 1000)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
})()
