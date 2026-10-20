declare module 'guacamole-common-js' {
  export class WebSocketTunnel {
    constructor(url: string)
  }

  export class Mouse {
    constructor(element: HTMLElement)
    onmousedown: ((state: unknown) => void) | null
    onmouseup: ((state: unknown) => void) | null
    onmousemove: ((state: unknown) => void) | null
    onEach(
      types: string[],
      listener: (event: { state: unknown }) => void,
    ): void
  }

  export class Keyboard {
    constructor(element: Document | HTMLElement)
    onkeydown: ((keysym: number) => void) | null
    onkeyup: ((keysym: number) => void) | null
  }

  export class Client {
    constructor(tunnel: WebSocketTunnel)
    connect(data?: string): void
    disconnect(): void
    sendSize(width: number, height: number): void
    sendMouseState(state: unknown, applyDisplayScale?: boolean): void
    sendKeyEvent(pressed: boolean | number, keysym: number): void
    getDisplay(): {
      getElement(): HTMLElement
      getWidth(): number
      getHeight(): number
      scale(scale: number): void
      showCursor(shown: boolean): void
    }
    onerror: ((status: { message?: string; code?: number }) => void) | null
    onstatechange: ((state: number) => void) | null
  }

  const Guacamole: {
    WebSocketTunnel: typeof WebSocketTunnel
    Client: typeof Client
    Mouse: typeof Mouse
    Keyboard: typeof Keyboard
  }

  export default Guacamole
}
