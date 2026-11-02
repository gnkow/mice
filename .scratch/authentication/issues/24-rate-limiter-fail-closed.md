Status: done

# 24: Rate limits on authentication endpoints

**Spec:** `.specs/01-authentication.md` (U22, Q24)

**Blocked by:** none

Device-approval limiting is issue 25 and stays on its own counter.

## What to build

Login callback, device-flow start, and token refresh use the shared Postgres rate-limit counters so every BFF instance sees the same counts. Limits: login callback 10/minute per IP, device-flow start 5/minute per IP, token refresh 20/minute per IP, token mint 10/hour per Principal. Over the limit, respond 429 with `Retry-After`. If the counter store cannot be read or written, respond 503 and log the outage.

## Outcome

`GET /auth/callback`, `POST /auth/cli/device/start`, and `POST /auth/cli/refresh` check the shared `rate_limits` counter before they do their work. The limits are 10 login callbacks per minute per IP, 5 device-flow starts per minute per IP, and 20 refreshes per minute per IP. Over the limit the response is 429 with `Retry-After: 60`. A failed read or a failed write of the counter returns 503 and is logged. Two apps in one process share the counter because both use the same Postgres table. Device approval keeps the issue 25 counter.

There is no live token-mint route. PAT mint is unregistered, and device approval is not this counter, so the configured 10-per-hour Principal mint limit is not attached to a request.

## Acceptance

- [x] Login callback, device-flow start, and token refresh call the shared limiter before doing work
- [x] The login, device-start, and refresh thresholds above are the ones enforced
- [x] A store error returns 503 and is logged
- [x] A count over the limit returns 429 with `Retry-After`
- [x] Two BFF instances share one counter for the same key
