# MICE Auth UI — Design Brief

Generated with ui-ux-pro-max (`.agents/skills/ui-ux-pro-max`), dials: variance 2 / motion 3 / density 8.

## Locked: keep MICE tokens

Do **not** adopt the skill’s suggested blue/orange palette or Plus Jakarta Sans. Map guidance onto existing variables in `web/src/App.css`:

| Role | Use |
|------|-----|
| Accent / CTA | `--accent`, `--accent-hover`, `--btn-primary-fg` |
| Surface | `--panel`, `--bg`, `--canvas-subtle` |
| Text | `--fg`, `--muted` |
| Borders | `--line` (prefer over ad-hoc `--color-border`) |
| Danger / success | `--danger`, `--success` |
| Radius / shadow | `--radius`, `--shadow` |
| Fonts | `--font-display`, `--font-body` (existing) |

Style: Minimal / Swiss — dense admin UI, high contrast, geometric, subtle 150–250ms transitions. No emoji icons (Lucide only). Respect `prefers-reduced-motion`.

## UX rules for auth surfaces

1. **Forms:** Visible `<label>` / `fieldset`+`legend`; never placeholder-only. Errors with `role="alert"` near the field (and optional top summary). Controlled inputs; `onSubmit` + `preventDefault`.
2. **Submit feedback:** Busy → disable primary; button text or `aria-busy`; then success/error flash.
3. **Focus:** Visible focus rings; modals keep focus visible and unobscured.
4. **Badges/chips:** Native buttons or semantic spans; `nowrap` when practical; pending/role text not color-only.
5. **Touch:** Interactive targets ≥44×44px where practical; 8px+ spacing between controls.
6. **Auth shell:** One composition — brand, one headline, one lede, one primary action group; Sign out secondary.
7. **Destructive vs primary:** Approve = `.btn.primary`; Deny = danger/ghost with clear label — never same visual weight.

## Spacing (dense)

Auth cards: comfortable padding (~1.5–2rem). Lists/settings: tighter rows (8–12px gaps). Permission multi-select: scroll region with `--line` border, shared `.perm-multiselect` class.

## Anti-patterns

- Inline style soup for layout/color (move to CSS classes)
- Mixing undefined CSS vars (`--color-border`) with MICE tokens
- Hover-only actions; removing focus outlines
- Full-app brand redesign or new font stack for this pass

## Skill path

```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux
```
