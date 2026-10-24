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

## Decision

Stay on **guacamole_lite** (default) or **rustguac** until this spike is run and an ADR promotes IronRDP.
