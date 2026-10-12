# Boxen

Open-source web UI for [Oxen](https://www.oxen.ai) / self-hosted [`oxen-server`](https://docs.oxen.ai/getting-started/oxen-server).

## Layout

| Path | Role |
| --- | --- |
| `compose.yaml` | Composable stack: `oxen-server` (+ optional `web` profile) |
| `web/` | Vite + React + TypeScript UI scaffold |
| `FEATURES.md` | Checklist of Oxen capabilities to expose in the UI |
| `TESTS.md` | Test plan + recommended frameworks for full coverage |

## Prerequisites

Oxen publishes the server image as a release tarball (not always pullable from a registry).

```bash
# Apple Silicon
curl -fsSL -o /tmp/oxen-server-docker-arm64.tar \
  -L "https://github.com/Oxen-AI/Oxen/releases/latest/download/oxen-server-docker-arm64.tar"
docker load < /tmp/oxen-server-docker-arm64.tar

# x86_64 — use oxen-server-docker-x86_64.tar instead
```

## Run

```bash
docker compose up --build
# → UI  http://localhost:5173
# → API http://localhost:3001
```

Or develop the UI against a running server:

```bash
docker compose up -d oxen-server
cd web && npm install && npm run dev
```

## Tests

```bash
make up         # start stack
make test       # headless E2E
make smoke      # smoke suite only
make test-view  # headed + slow-mo (watch in browser)
make clean      # stop stack, wipe volumes + deps + test artifacts
```

Atomic E2E case catalog (per FEATURES ID, with coverage + backlog): [`TESTS.md`](./TESTS.md).

## Progress

Track UI coverage in [`FEATURES.md`](./FEATURES.md) and the Playwright case catalog in [`TESTS.md`](./TESTS.md). Hub-only surfaces (inference, fine-tuning, SSO) are listed in `FEATURES.md` as out of scope for OSS `oxen-server`.
