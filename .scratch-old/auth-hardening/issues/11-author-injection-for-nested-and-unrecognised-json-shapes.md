# 11: Author injection for nested and unrecognised JSON shapes

**What to build:** JSON objects whose author fields are nested (e.g. a commit object) or use other author-like keys (e.g. `committer`) no longer pass through un-injected. Either injection covers those shapes or the BFF rejects JSON bodies on author-bearing routes that it cannot classify, so unknown shapes fail closed instead of only parse failures.

**Blocked by:** 01 (author injection fails closed; done)

**Status:** ready-for-agent

- [x] Nested `author`/`committer` fields in a write body never reach the fake upstream with client values
- [x] Existing flat shapes keep their current injection
- [x] Repo-create (`name` as repository name) is not treated as an author
- [x] Rejections audited
- [x] Shape rules documented next to the injection code
