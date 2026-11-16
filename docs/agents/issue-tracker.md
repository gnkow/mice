# Issue tracker: GitHub Issues + Project

Issues for this repo live on GitHub. Specs remain as markdown in `.specs/`.

## Canonical locations

- **Feature / spec parents:** GitHub issues labeled `feature` (one per `.specs/NN-*.md`, plus Training). Body links to the in-repo spec file.
- **Implementation tickets:** GitHub issues labeled `implementation`, linked as **sub-issues** of the matching feature/spec parent.
- **Board:** GitHub Project [Mice](https://github.com/users/gnkow/projects/5) (Kanban Status: Todo / In Progress / Done), linked to this repository.
- **Specs (source of truth for product intent):** `.specs/<NN>-<slug>.md` in the repo

## Conventions

- Triage state is a GitHub label (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, `deferred`). See `triage-labels.md`.
- Area is a GitHub label `area:<slug>` (e.g. `area:authentication`).
- Closed work uses GitHub issue state Closed (Done on the project board). `wontfix` / `deferred` keep those labels.

## When a skill says "publish to the issue tracker"

Create a GitHub issue on this repository with `gh issue create` (or the GitHub UI):

- Feature/spec work: label `feature` + `area:<slug>`; link the `.specs/…` path in the body.
- Implementation work: label `implementation` + `area:<slug>` + a triage label; add it as a **sub-issue** of the parent feature/spec issue; add it to project Mice.

## When a skill says "fetch the relevant ticket"

Open or `gh issue view <number>` for the referenced GitHub issue. The user will normally pass the issue number or URL.

## Wayfinding operations

Used by `/wayfinder`. Prefer GitHub issues over local files:

- Parent effort / map context can live in the feature/spec parent issue body (or linked notes).
- Child tickets are sub-issues of that parent.
- Blocking relationships: document with `Blocked by: #N` in the issue body (and GitHub blockers when available).
- Frontier: open sub-issues on the parent that are unblocked and labeled `ready-for-agent` / `ready-for-human`.
- Claim / resolve: use GitHub assignees and issue state (and project Status) rather than editing local markdown.
