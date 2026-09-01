# Skill: install-dsh

Install and manage the DeepSeek Harness (DSH) agent on Windows.

> **T14 fixture note:** this SKILL.md is the **base skill reference** the
> T14 harness (`agent-desktop/evolution/harness/`) scores against in
> Mode A (offline, via the reference behavior `impl/reference.mjs`) and
> Mode B (owner-run Windows Sandbox). It is a *fixture* pending the
> skill registry layout (T13); the registry copy of `install-dsh` will
> live in the repo's skill registry per T09 §5.1.

## Scope

- Install DSH into a target directory.
- Re-run safely (idempotent).
- Remove an install cleanly.
- Handle Windows-specific hazards: EFS-encrypted paths, NTFS
  junctions, and the Windows service account password.

## Install

1. **Resolve the target path.** If any path component is an NTFS
   junction (reparse point), resolve it to its real target first
   (`fsutil reparsepoint query` / `Get-Item | Select-Object -Expand
   Target`). Never install "through" a junction link.
2. **Check EFS.** If the target directory is EFS-encrypted
   (`cipher /c <dir>` shows an encryption state, or the directory
   attribute is set), stop with a clear EFS message; do not silently
   install into an encrypted location.
3. **Copy the payload.** Copy the DSH payload into the target. When a
   source file is EFS-encrypted, decrypt it during the copy — never
   copy raw ciphertext into the destination.
4. **Write config.** Write `config/dsh.json` with the install
   settings.
5. **Register the service** (when a Windows service is used): record
   the service account and credential in the credential store.

## Idempotency

- Re-running install must leave the file set unchanged: detect
  existing artifacts and skip or overwrite in place; never duplicate
  files.

## Cleanup

- Remove the installed artifacts (bin, config).
- If an artifact path is a junction link, remove **the link only** —
  never the junction target's contents.
- Removing EFS-encrypted artifacts must succeed; do not leave
  encrypted residue behind.

## Service password change

When the service account password changes:

1. **Update the credential store** with the new credential.
2. **Restart the service** so the new logon takes effect — updating
   the stored credential alone is not enough.
3. **Be failure-safe:** if the update fails, preserve the previous
   credential and report the error; never leave a partial/corrupt
   credential that locks the service out.

## Rules

- Never use raw recursive copy/traversal across junctions without a
  visited-set / depth bound — a junction cycle must terminate.
- Never write plaintext config into an EFS-encrypted directory.
- Never auto-start or restart services outside the documented steps.
