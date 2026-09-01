# Skill: install-dsh

Install and manage the DeepSeek Harness (DSH) agent on Windows.

> Judge-real fixture note: candidate-skill.md is the **candidate diff**
> for the Q5 real 3-model judge run (Redmine #52). It preserves the
> base skill's intent (install + verify, idempotent) and adds one
> minimal, reviewable section (upgrade). No secrets.

## Scope

- Install DSH into a target directory.
- Re-run safely (idempotent).
- Remove an install cleanly.
- Upgrade an existing install to the latest release.

## Install

1. **Resolve the target path.** If any path component is an NTFS
   junction (reparse point), resolve it to its real target first.
   Never install "through" a junction link.
2. **Check EFS.** If the target directory is EFS-encrypted, stop with
   a clear EFS message; do not silently install into an encrypted
   location.
3. **Copy the payload.** Copy the DSH payload into the target.
4. **Verify.** Run `dsh doctor` and confirm the install works.

## Upgrade

1. Re-download the latest DSH release into the install target.
2. Re-run `dsh doctor` to confirm the new version works.
