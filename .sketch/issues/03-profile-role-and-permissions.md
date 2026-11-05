Status: done

# 03 — Profile role badge and Permissions UI

## Problem

Profile Account/Permissions use heavy inline styles; role badge and request-additional flow need clearer hierarchy and a11y.

## Files

- `web/src/pages/ProfilePage.tsx`
- `web/src/lib/profileRoleBadge.ts`
- `web/src/App.css`

## Acceptance

- [x] Account card + role badge use shared CSS classes (not inline style soup)
- [x] Permissions tab remains scannable; pending indicator clear
- [x] Request-additional form matches pending-access form patterns
- [x] Behavior/payloads unchanged
