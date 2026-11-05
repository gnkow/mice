Status: done

# 02 — Login and Pending Access UI

## Problem

Login and no-access Request Access share `.login-shell` but need clearer hierarchy, form feedback, and pending confirmation UX.

## Files

- `web/src/pages/LoginPage.tsx`
- `web/src/pages/PendingAccessPage.tsx`
- `web/src/App.css` (`.login-shell`, `.pending-access`)

## Acceptance

- [x] Clear brand + single primary CTA on login
- [x] Request Access form: visible labels, errors near fields, disabled/loading feedback
- [x] Submitted/pending state is calm and unambiguous
- [x] Touch targets and focus rings meet brief; RBAC submit payload unchanged
