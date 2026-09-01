/**
 * Mode A sandbox — deterministic, disposable fixture environment.
 *
 * Simulates the Windows-only behaviors the install-dsh suite targets
 * (T09 §5.4 Q3: "Windows-only behaviors simulated/fixtured as planted
 * failures"), so the same assertions run in a Linux container / CI:
 *
 * - **EFS (Encrypting File System):** a sidecar store maps real paths
 *   to an "encrypted" flag (the Windows EFS attribute). Encrypted file
 *   content is stored as `CIPHERTEXT:<base64>` to model unreadable
 *   ciphertext.
 * - **Junction (reparse point):** a sidecar store maps link path →
 *   target path (the Windows junction semantics). Resolving a link
 *   returns the real target; a cycle in the store models the recursion
 *   loop a naive skill would hit.
 * - **Service credential store:** a JSON store for the DSH service
 *   (`dsh`) with `passwordHash`, `running`, `restartCount` — models the
 *   Windows service account password the skill must update + restart.
 *
 * Every run creates a fresh temp dir (disposable per run, SEC-GEPA-01);
 * `destroy()` removes it. Deterministic: no wall-clock-dependent
 * behavior, no network.
 */
import {
  mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ENCRYPTED_PREFIX = 'CIPHERTEXT:';

export function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'gepa-harness-'));
  const efsStore = join(root, '.efs.json');
  const junctionStore = join(root, '.junctions.json');
  const serviceStore = join(root, '.services.json');

  writeFileSync(efsStore, '{}');
  writeFileSync(junctionStore, '{}');
  writeFileSync(serviceStore, JSON.stringify({
    dsh: {
      user: 'dsh-svc',
      passwordHash: 'OLD_HASH',
      running: true,
      restartCount: 0,
    },
  }, null, 2));

  const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const writeJSON = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

  return {
    root,
    efsStore,
    junctionStore,
    serviceStore,

    /** absolute path inside the sandbox */
    path: (rel) => join(root, rel),

    mkdir(rel) { mkdirSync(this.path(rel), { recursive: true }); return this.path(rel); },
    write(rel, content) {
      const abs = this.path(rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
      return abs;
    },
    read(rel) { return readFileSync(this.path(rel), 'utf8'); },
    exists(rel) { return existsSync(this.path(rel)); },

    // ---------- EFS fixtures ----------
    markEncrypted(rel) {
      const s = readJSON(efsStore);
      s[resolve(this.path(rel))] = { encrypted: true };
      writeJSON(efsStore, s);
    },
    isEncrypted(rel) {
      const s = readJSON(efsStore);
      return !!s[resolve(this.path(rel))]?.encrypted;
    },
    /** write an EFS-encrypted file: ciphertext on disk, flag in store */
    writeEncrypted(rel, plaintext) {
      const abs = this.write(rel, `${ENCRYPTED_PREFIX}${Buffer.from(plaintext).toString('base64')}`);
      this.markEncrypted(abs);
      return abs;
    },

    // ---------- Junction fixtures ----------
    createJunction(linkRel, targetRel) {
      const s = readJSON(junctionStore);
      s[resolve(this.path(linkRel))] = resolve(this.path(targetRel));
      writeJSON(junctionStore, s);
    },
    junctionTarget(linkRel) {
      const s = readJSON(junctionStore);
      return s[resolve(this.path(linkRel))] || null;
    },
    junctionLinks() {
      const s = readJSON(junctionStore);
      return Object.keys(s);
    },

    // ---------- Service store ----------
    readServiceStore: () => readJSON(serviceStore),
    writeServiceStore: (v) => writeJSON(serviceStore, v),
    /** inject a fault so the next credential update fails (svc-failure-safe) */
    setServiceFault(on) {
      const s = readJSON(serviceStore);
      s._fault = on ? true : undefined;
      writeJSON(serviceStore, s);
    },

    // per-case captured output accumulator (reset by the runner)
    captured: [],

    destroy() { rmSync(root, { recursive: true, force: true }); },
  };
}
