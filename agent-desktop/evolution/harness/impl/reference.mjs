/**
 * Reference behavior — the executable proxy of the **base skill**
 * (`fixtures/install-dsh/SKILL.md`) as understood by the T14 harness.
 *
 * This is the deterministic Mode A encoding of the correct handling
 * the base skill documents: EFS detection before install, decryption
 * when copying from an EFS source, junction resolution + bounded
 * traversal + junction-safe cleanup, and service-password change with
 * restart and failure-safe rollback.
 *
 * A candidate skill is scored by providing a behavior module with the
 * same interface (T12 maps candidate SKILL.md -> behavior proxy, or
 * runs this reference for the base-skill regression subset,
 * SEC-GEPA-04). Every method returns plain serializable data so the
 * result JSON stays machine-readable.
 */
import { rmSync } from 'node:fs';

const REFERENCE = {
  id: 'reference',
  label: 'base skill (install-dsh) reference behavior',

  // ------------------------------------------------------------ happy path
  install(sandbox) {
    sandbox.mkdir('target');
    sandbox.write('target/bin/dsh', '#!/bin/sh\necho dsh\n');
    sandbox.write('target/config/dsh.json', '{"installed":true}');
    return { ok: true, message: 'install complete', artifacts: ['target/bin/dsh', 'target/config/dsh.json'] };
  },

  cleanup(sandbox) {
    // Remove only known artifacts; junction-safe removal happens in
    // jctCleanup — here we remove plain files + dirs under target/.
    if (sandbox.exists('target')) {
      rmDir(sandbox, 'target');
    }
    return { ok: true, message: 'cleanup complete', remaining: [] };
  },

  // ---------------------------------------------------------------------- efs
  efsDetectTarget(sandbox) {
    if (sandbox.isEncrypted('target')) {
      return { detected: true, message: 'EFS: target directory is encrypted — decrypt or choose a non-encrypted target' };
    }
    return { detected: false, message: 'target not EFS-encrypted' };
  },

  efsCopySource(sandbox) {
    // Reference behavior decrypts EFS-encrypted sources: strips the
    // CIPHERTEXT: prefix and base64-decodes the payload.
    if (!sandbox.exists('src/data.bin')) {
      return { ok: false, message: 'source missing', dstEncrypted: false };
    }
    const raw = sandbox.read('src/data.bin');
    if (raw.startsWith('CIPHERTEXT:')) {
      const plain = Buffer.from(raw.slice('CIPHERTEXT:'.length), 'base64').toString('utf8');
      sandbox.mkdir('dst');
      sandbox.write('dst/data.bin', plain);
      return { ok: true, message: 'decrypted on copy', dstEncrypted: false };
    }
    sandbox.mkdir('dst');
    sandbox.write('dst/data.bin', raw);
    return { ok: true, message: 'copied (plain source)', dstEncrypted: false };
  },

  efsCleanup(sandbox) {
    if (sandbox.exists('target')) rmDir(sandbox, 'target');
    return { ok: true, message: 'cleanup removed encrypted artifacts', remaining: [] };
  },

  // ------------------------------------------------------------------ junction
  jctResolve(sandbox) {
    const target = sandbox.junctionTarget('link');
    return { resolvedPath: target ?? sandbox.path('link'), message: target ? 'resolved junction' : 'not a junction' };
  },

  jctTraverse(sandbox) {
    // Bounded DFS that resolves junctions and tracks visited real paths.
    const visited = new Set();
    let count = 0;
    const maxSteps = 1000;
    const walk = (rel) => {
      if (count > maxSteps) return false; // runaway guard
      const abs = sandbox.path(rel);
      const key = sandbox.junctionTarget(rel) ?? abs;
      if (visited.has(key)) return true;
      visited.add(key);
      count += 1;
      // If this entry is a junction link, follow it once, then descend.
      const realRel = sandbox.junctionTarget(rel);
      if (realRel) {
        // resolve: continue at the real path
        return walk(realRel === sandbox.path(rel) ? '' : realRel);
      }
      return true;
    };
    const terminated = walk('a');
    return { terminated, visited: count, message: `traversed ${count} nodes` };
  },

  jctCleanup(sandbox) {
    // Remove the junction link only (the `link` directory entry itself);
    // leave the real target and its contents untouched.
    const target = sandbox.junctionTarget('link');
    if (target) {
      if (sandbox.exists('link')) rmDir(sandbox, 'link'); // removes the link entry
      return { linkRemoved: true, targetIntact: true, message: 'junction link removed; target contents kept' };
    }
    return { linkRemoved: false, targetIntact: true, message: 'no junction to clean' };
  },

  // ------------------------------------------------------------ service password
  svcUpdateCredential(sandbox, newHash) {
    const store = sandbox.readServiceStore();
    if (store._fault) {
      return { ok: false, message: 'credential update failed: store fault injected', updated: false };
    }
    store.dsh.passwordHash = newHash;
    store.dsh.restartCount = (store.dsh.restartCount ?? 0) + 1;
    store.dsh.running = true;
    sandbox.writeServiceStore(store);
    return { ok: true, message: 'credential updated + service restarted', updated: true, restarted: true };
  },

  svcFailureSafe(sandbox) {
    // On failure, previous credential must be preserved (no partial write).
    const store = sandbox.readServiceStore();
    const before = store.dsh.passwordHash;
    const result = this.svcUpdateCredential(sandbox, 'NEW_HASH');
    const after = sandbox.readServiceStore().dsh.passwordHash;
    const preserved = result.ok === false && after === before;
    return {
      ok: result.ok,
      credentialPreserved: preserved,
      message: preserved ? 'failure safe: previous credential preserved' : 'NOT safe: credential changed or corrupted',
    };
  },
};

function rmDir(sandbox, rel) {
  rmSync(sandbox.path(rel), { recursive: true, force: true });
}

function rmFile(sandbox, rel) {
  rmSync(sandbox.path(rel), { force: true });
}

export default REFERENCE;
