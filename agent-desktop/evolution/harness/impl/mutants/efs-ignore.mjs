/**
 * Planted failure mutant — **EFS-ignore**.
 *
 * Simulates a skill that ignores Windows EFS: it does not detect an
 * EFS-encrypted install target, raw-copies encrypted sources (leaving
 * ciphertext), and fails to remove encrypted artifacts during cleanup.
 * Used to prove the suite actually catches the EFS failure mode
 * (expected failures: efs-detect-target, efs-copy-source,
 * efs-cleanup-encrypted).
 */
import reference from '../reference.mjs';
import { rmSync } from 'node:fs';

export default {
  ...reference,
  id: 'efs-ignore',
  label: 'mutant: ignores EFS encryption',

  efsDetectTarget() {
    return { detected: false, message: 'target looks fine' }; // wrong: ignores EFS
  },

  efsCopySource(sandbox) {
    // wrong: raw byte copy — ciphertext (CIPHERTEXT:...) is copied verbatim
    if (!sandbox.exists('src/data.bin')) {
      return { ok: false, message: 'source missing', dstEncrypted: false };
    }
    sandbox.mkdir('dst');
    sandbox.write('dst/data.bin', sandbox.read('src/data.bin'));
    return { ok: true, message: 'copied', dstEncrypted: true }; // ciphertext kept
  },

  efsCleanup(sandbox) {
    // wrong: skips encrypted files -> residue remains
    let remaining = [];
    if (sandbox.exists('target/bin/dsh') && sandbox.isEncrypted('target/bin/dsh')) {
      remaining = ['target/bin/dsh'];
    } else if (sandbox.exists('target')) {
      rmSync(sandbox.path('target'), { recursive: true, force: true });
    }
    return { ok: remaining.length === 0, message: 'cleanup attempted', remaining };
  },
};
