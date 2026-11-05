Status: done

# 04 — Settings Access Requests and Grant Access UI

## Problem

Manager/admin review and direct grant UIs are dense; status filters, modify-before-approve, and authority errors need clearer presentation.

## Files

- `web/src/pages/SettingsPage.tsx`
- `web/src/lib/accessRequestReview.ts`
- `web/src/App.css`

## Acceptance

- [x] Access Requests list + filters easy to scan
- [x] Review modal: modify role/perms, approve/deny, authority errors near actions
- [x] Grant Access modal: expiry/reason clarity
- [x] Behavior/authority rules unchanged
