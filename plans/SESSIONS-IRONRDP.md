# Sessions — IronRDP spike notes (Phase 3)

Deferred performance / architecture spike for [`PLAT-SESS`](./EPICS.md#plat-sess--desktop-sessions). **v1 Connect remains rustguac or guacamole-lite + guacd** (see [Sessions.md](./Sessions.md)).

## Why spike

Guacamole-class gateways **re-encode** RDP/VNC into the Guacamole protocol on the server (CPU-bound under concurrency). IronRDP runs RDP (often in WASM) so the gateway mostly **relays bytes**.

## Candidates

| Stack | Notes |
| --- | --- |
| [IronRDP](https://github.com/Devolutions/IronRDP) | Protocol library; used by Devolutions Gateway, Cloudflare Access, Teleport |
| [Warpgate](https://github.com/warp-tech/warpgate) | Rust bastion; browser RDP via IronRDP helper |
| [Devolutions Gateway](https://github.com/Devolutions/devolutions-gateway) | Production IronRDP browser RDP |
| Custom | Thin WS↔TCP relay + IronRDP WASM in Mice UI |

## Linux-first constraint

Most Mice Sessions guests are **Linux + xrdp**. IronRDP is strongest against Windows RDP; validate **xrdp** (and optionally GNOME/KDE RDP) before adopting.

## Acceptance criteria to switch Connect backend

1. Input lag ≤ guacamole-lite path on same LAN (click-to-pixel)
2. guacd/auth CPU lower at N concurrent Sessions (document N)
3. OIDC + Mice AuthZ ticket handoff equivalent to today’s Connect API
4. Exclusive Sessions (no share/join) preserved
5. License review (AGPL / commercial CE limits) acceptable

## Additional criteria and open items (proposed; none approved)

- [ ] **Fallback and compatibility matrix:** browser × guest (xrdp XFCE/MATE, GNOME/KDE RDP, optional Windows) × gateway (guacamole_lite, rustguac, IronRDP) with pass/fail per row; automatic or user-selectable **fallback to the Guacamole path** when WASM/WebSocket/codec support is missing or the RDP handshake fails (NLA/TLS/security-layer variants)
- [ ] **Clipboard and file transfer:** text and image clipboard both directions, drive/file redirection, each switchable by the Sessions security policy ([Sessions.md](./Sessions.md) Phase 4); defaults must not be looser than the Guacamole path
- [ ] **Reconnect:** network drop and tab close/reopen reconnect to the same guest without data loss; behavior on gateway restart and ticket expiry; resolution/DPI change on resume
- [ ] **Browser support criteria:** minimum supported versions (Chromium, Firefox, Safari) and required features (WASM, WebCodecs/SharedArrayBuffer headers, WebSocket through the BFF); unsupported browsers get a clear message and the fallback
- [ ] **Recording and connection audit:** IronRDP relays bytes, so server-side recording and connection audit (IP, start/end, policy, clipboard/file events) must be replaced explicitly — equivalent to [Sessions.md](./Sessions.md) Phase 4 or documented as a gap blocking the switch

### Open questions

1. Where would recording happen with a byte-relay gateway (relay tap, guest-side agent) and is it acceptable for regulated use?
2. Which of the matrix rows are required for the ADR, and which may stay fallback-only?
3. Is per-feature clipboard/file policy enforceable when the gateway cannot parse RDP virtual channels?

## Decision

Stay on **guacamole_lite** (default) or **rustguac** until this spike is run and an ADR promotes IronRDP.
