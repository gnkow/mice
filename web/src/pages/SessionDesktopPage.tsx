import Guacamole from 'guacamole-common-js'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { fetchConnectToken } from '../lib/sessions'

type GuacClient = {
  connect: (data?: string) => void
  disconnect: () => void
  sendMouseState: (state: unknown, applyDisplayScale?: boolean) => void
  sendKeyEvent: (pressed: boolean | number, keysym: number) => void
  getDisplay: () => {
    getElement: () => HTMLElement
    getWidth: () => number
    getHeight: () => number
    scale: (scale: number) => void
    showCursor: (shown: boolean) => void
  }
  onerror: ((status: { message?: string; code?: number }) => void) | null
  onstatechange: ((state: number) => void) | null
}

type GuacMouse = {
  onEach: (
    types: string[],
    listener: (event: { state: unknown }) => void,
  ) => void
}

type GuacKeyboard = {
  onkeydown: ((keysym: number) => boolean | void) | null
  onkeyup: ((keysym: number) => void) | null
}

/**
 * Browser desktop viewer for guacamole-lite + guacamole-common-js 1.5.
 * Uses onEach mouse API and display.scale() (never CSS width/height on the
 * Guacamole root — that blanks the layered canvases).
 */
export function SessionDesktopPage() {
  const { sessionId = '' } = useParams()
  const [params] = useSearchParams()
  const ticket = params.get('ticket') || ''
  const displayRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('Connecting…')

  useEffect(() => {
    if (!sessionId || !ticket) {
      setError('Missing session or ticket')
      return
    }
    let cancelled = false
    let client: GuacClient | null = null
    let keyboard: GuacKeyboard | null = null
    let fitObserver: ResizeObserver | null = null

    function fitDisplay() {
      if (!client || !displayRef.current) return
      const display = client.getDisplay()
      const dw = display.getWidth()
      const dh = display.getHeight()
      if (!dw || !dh) return
      const rect = displayRef.current.getBoundingClientRect()
      const scale = Math.min(rect.width / dw, rect.height / dh, 1)
      try {
        display.scale(scale > 0 ? scale : 1)
      } catch {
        /* ignore */
      }
    }

    async function run() {
      try {
        setStatus('Fetching connect token…')
        const { token, ws_path } = await fetchConnectToken(sessionId, ticket)
        if (cancelled) return

        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
        const wsUrl = `${proto}://${window.location.host}${ws_path}?token=${encodeURIComponent(token)}`
        const tunnel = new Guacamole.WebSocketTunnel(wsUrl)
        client = new Guacamole.Client(tunnel) as GuacClient
        client.onerror = (st) => {
          setError(
            st?.message ||
              `Guacamole error${st?.code != null ? ` (${st.code})` : ''}`,
          )
        }
        client.onstatechange = (state) => {
          if (state === 1) setStatus('Connecting…')
          if (state === 2) setStatus('Waiting…')
          if (state === 3) {
            setStatus('Connected')
            // Remote framebuffer size arrives just after connected.
            requestAnimationFrame(fitDisplay)
            setTimeout(fitDisplay, 300)
            setTimeout(fitDisplay, 1000)
          }
          if (state === 5) setStatus('Disconnected')
        }

        const display = client.getDisplay()
        const el = display.getElement()
        el.style.cursor = 'default'
        displayRef.current?.replaceChildren(el)
        try {
          display.showCursor(false)
        } catch {
          /* older builds */
        }

        const mouse = new Guacamole.Mouse(el) as GuacMouse
        mouse.onEach(['mousedown', 'mouseup', 'mousemove'], (event) => {
          client?.sendMouseState(event.state, true)
        })

        keyboard = new Guacamole.Keyboard(document) as GuacKeyboard
        keyboard.onkeydown = (keysym) => {
          client?.sendKeyEvent(1, keysym)
        }
        keyboard.onkeyup = (keysym) => {
          client?.sendKeyEvent(0, keysym)
        }

        if (displayRef.current && typeof ResizeObserver !== 'undefined') {
          fitObserver = new ResizeObserver(() => fitDisplay())
          fitObserver.observe(displayRef.current)
        }
        window.addEventListener('resize', fitDisplay)

        client.connect('')
        setStatus('Handshake…')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Connect failed')
        }
      }
    }
    void run()
    return () => {
      cancelled = true
      window.removeEventListener('resize', fitDisplay)
      fitObserver?.disconnect()
      try {
        if (keyboard) {
          keyboard.onkeydown = null
          keyboard.onkeyup = null
        }
        client?.disconnect()
      } catch {
        /* ignore */
      }
    }
  }, [sessionId, ticket])

  return (
    <div
      className="session-desktop-fullscreen"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
        color: '#e8e8e8',
      }}
    >
      <header
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 12px',
          background: 'rgba(0,0,0,0.85)',
          borderBottom: '1px solid #333',
          fontSize: 13,
        }}
      >
        <Link
          to={`/sessions/${encodeURIComponent(sessionId)}`}
          style={{ color: '#9cf' }}
        >
          ← Session
        </Link>
        <span style={{ opacity: 0.7 }}>{status}</span>
        {error ? (
          <span style={{ color: '#f88', marginLeft: 'auto' }}>{error}</span>
        ) : (
          <span style={{ opacity: 0.5, marginLeft: 'auto' }}>
            Click desktop for keyboard focus
          </span>
        )}
      </header>
      <div
        ref={displayRef}
        className="session-desktop-display"
        tabIndex={0}
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          width: '100%',
          background: '#111',
          overflow: 'hidden',
          position: 'relative',
          outline: 'none',
          cursor: 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseDown={(e) => {
          ;(e.currentTarget as HTMLDivElement).focus()
        }}
      />
    </div>
  )
}
