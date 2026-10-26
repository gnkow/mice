# 04: Write role can push through the BFF

**What to build:** A Write collaborator can complete a push (commit upload, commit publish, version chunks) through the BFF. A Read collaborator cannot.

**Blocked by:** 02 (single path table)

**Status:** done

- [x] A test pushes as a Write collaborator first; it fails today if those routes fall back to admin
- [x] Push-related routes classified as Write in the table
- [x] Read collaborator push is 403 and oxen is not called
- [x] Merge and destructive routes keep their Maintain and Admin requirements
