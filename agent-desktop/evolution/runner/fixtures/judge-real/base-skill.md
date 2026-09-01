# Skill: install-dsh

Install and manage the DeepSeek Harness (DSH) agent on Windows.

> Judge-real fixture note: base-skill.md is the **base skill reference**
> (semantic anchor) for the Q5 real 3-model judge run (Redmine #52). It
> is a small, self-contained stand-in for the T14 `install-dsh` base —
> same shape, no secrets, safe to commit.

## Scope

- Install DSH into a target directory.
- Re-run safely (idempotent).
- Remove an install cleanly.

## Install

1. **Resolve the target path.** If any path component is an NTFS
   junction (reparse point), resolve it to its real target first.
   Never install "through" a junction link.
2. **Check EFS.** If the target directory is EFS-encrypted, stop with
   a clear EFS message; do not silently install into an encrypted
   location.
3. **Copy the payload.** Copy the DSH payload into the target.
4. **Verify.** Run `dsh doctor` and confirm the install works.
