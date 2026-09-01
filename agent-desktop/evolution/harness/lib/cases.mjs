/**
 * Mode A case checks — the executable definition of every manifest case.
 *
 * Each check runs against a **behavior** (the executable proxy of the
 * skill under test — reference base skill or a planted-failure mutant)
 * inside a disposable sandbox and returns
 * `{status, expected, actual, captured[]}`. `status` is one of
 * pass | fail | skip | error; the fitness function counts only `pass`.
 *
 * The manifest (`manifest.json`) is the single source of case metadata
 * (id / scenario / weight / pass_criteria); this module attaches the
 * Mode A executable check by matching case id. A case without a check
 * is reported as `skip` (documented — T12 must not silently pass it).
 */
import { readdirSync, statSync } from 'node:fs';
import { loadManifest } from './manifest.mjs';

/** expected/actual strings recorded into the result JSON */
function record(sandbox, expected, actual, extra = []) {
  return { expected, actual, captured: [...sandbox.captured, ...extra] };
}

const CHECKS = {
  // ---------------------------------------------------------------- happy path
  'hp-install': {
    check(sandbox, b) {
      const r = b.install(sandbox);
      const binOk = sandbox.exists('target/bin/dsh');
      const cfgOk = sandbox.exists('target/config/dsh.json');
      const expected = 'install ok; artifacts target/bin/dsh and target/config/dsh.json exist';
      const actual = `install.ok=${r.ok} bin=${binOk} config=${cfgOk}`;
      sandbox.captured.push(`behavior.install -> ${JSON.stringify(r)}`);
      return { ...record(sandbox, expected, actual), status: r.ok && binOk && cfgOk ? 'pass' : 'fail' };
    },
  },

  'hp-idempotency': {
    check(sandbox, b) {
      const first = b.install(sandbox);
      const before = listFiles(sandbox);
      const second = b.install(sandbox);
      const after = listFiles(sandbox);
      const same = JSON.stringify(before) === JSON.stringify(after);
      const expected = 'second install ok; file set unchanged (no duplicates)';
      const actual = `first.ok=${first.ok} second.ok=${second.ok} filesBefore=${before.length} filesAfter=${after.length} same=${same}`;
      sandbox.captured.push(`install#1 -> ${JSON.stringify(first)}`, `install#2 -> ${JSON.stringify(second)}`);
      return { ...record(sandbox, expected, actual), status: first.ok && second.ok && same ? 'pass' : 'fail' };
    },
  },

  'hp-cleanup': {
    check(sandbox, b) {
      const inst = b.install(sandbox);
      const first = b.cleanup(sandbox);
      const remaining1 = listFiles(sandbox);
      const second = b.cleanup(sandbox);
      const remaining2 = listFiles(sandbox);
      const expected = 'cleanup removes artifacts; repeated cleanup is a safe no-op';
      const actual = `install.ok=${inst.ok} cleanup1.ok=${first.ok} remaining1=${remaining1.length} cleanup2.ok=${second.ok} remaining2=${remaining2.length}`;
      sandbox.captured.push(`install -> ${JSON.stringify(inst)}`, `cleanup#1 -> ${JSON.stringify(first)}`, `cleanup#2 -> ${JSON.stringify(second)}`);
      const ok = first.ok && second.ok && remaining1.length === 0 && remaining2.length === 0;
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  // ---------------------------------------------------------------------- efs
  'efs-detect-target': {
    check(sandbox, b) {
      sandbox.mkdir('target');
      sandbox.markEncrypted('target'); // EFS-encrypted install target
      const r = b.efsDetectTarget(sandbox);
      const expected = 'EFS-encrypted target detected; message mentions EFS';
      const actual = `detected=${r.detected} message=${JSON.stringify(r.message ?? null)}`;
      sandbox.captured.push(`behavior.efsDetectTarget -> ${JSON.stringify(r)}`);
      const ok = r.detected === true && /efs/i.test(r.message ?? '');
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  'efs-copy-source': {
    check(sandbox, b) {
      sandbox.writeEncrypted('src/data.bin', 'PLAINTEXT-123');
      const r = b.efsCopySource(sandbox);
      const destContent = sandbox.exists('dst/data.bin') ? sandbox.read('dst/data.bin') : null;
      const expected = 'copy from EFS-encrypted source yields plaintext (no CIPHERTEXT: prefix)';
      const actual = `ok=${r.ok} destContent=${JSON.stringify(destContent)}`;
      sandbox.captured.push(`behavior.efsCopySource -> ${JSON.stringify(r)}`);
      const ok = r.ok === true && destContent === 'PLAINTEXT-123';
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  'efs-cleanup-encrypted': {
    check(sandbox, b) {
      sandbox.mkdir('target');
      sandbox.write('target/bin/dsh', 'dsh');
      sandbox.write('target/config/dsh.json', '{}');
      sandbox.markEncrypted('target/bin/dsh'); // artifact itself encrypted
      const r = b.efsCleanup(sandbox);
      const remaining = listFiles(sandbox);
      const expected = 'cleanup removes artifacts inside an EFS-encrypted dir (no residue)';
      const actual = `ok=${r.ok} remaining=${JSON.stringify(remaining)}`;
      sandbox.captured.push(`behavior.efsCleanup -> ${JSON.stringify(r)}`);
      const ok = r.ok === true && remaining.length === 0;
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  // ------------------------------------------------------------------ junction
  'jct-resolve': {
    check(sandbox, b) {
      sandbox.mkdir('real/target');
      sandbox.createJunction('link', 'real/target'); // link -> real/target
      const r = b.jctResolve(sandbox);
      const expected = `resolved path points at real target (${sandbox.path('real/target')})`;
      const actual = `resolved=${JSON.stringify(r.resolvedPath)}`;
      sandbox.captured.push(`behavior.jctResolve -> ${JSON.stringify(r)}`);
      const ok = r.resolvedPath === sandbox.path('real/target');
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  'jct-traverse': {
    check(sandbox, b) {
      sandbox.mkdir('a');
      sandbox.mkdir('b');
      sandbox.createJunction('a/loop', 'b');
      sandbox.createJunction('b/loop', 'a'); // cycle a <-> b
      const r = b.jctTraverse(sandbox, 'a');
      const expected = 'traversal through a junction cycle terminates (no infinite loop)';
      const actual = `terminated=${r.terminated} visited=${r.visited}`;
      sandbox.captured.push(`behavior.jctTraverse -> ${JSON.stringify(r)}`);
      const ok = r.terminated === true && Number.isInteger(r.visited) && r.visited > 0;
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  'jct-cleanup': {
    check(sandbox, b) {
      sandbox.mkdir('real/target');
      sandbox.write('real/target/keep.txt', 'keep me');
      sandbox.createJunction('link', 'real/target');
      const r = b.jctCleanup(sandbox);
      const linkGone = !sandbox.exists('link');
      const targetIntact = sandbox.exists('real/target/keep.txt');
      const expected = 'cleanup removes the junction link but keeps the target contents';
      const actual = `linkRemoved=${r.linkRemoved} targetIntact=${r.targetIntact} linkGone=${linkGone} targetKept=${targetIntact}`;
      sandbox.captured.push(`behavior.jctCleanup -> ${JSON.stringify(r)}`);
      const ok = r.linkRemoved === true && r.targetIntact === true && linkGone === true && targetIntact === true;
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  // ------------------------------------------------------------ service password
  'svc-update-credential': {
    check(sandbox, b) {
      const r = b.svcUpdateCredential(sandbox, 'NEW_HASH');
      const store = sandbox.readServiceStore();
      const expected = 'stored credential hash equals the new password hash';
      const actual = `ok=${r.ok} stored=${store.dsh.passwordHash}`;
      sandbox.captured.push(`behavior.svcUpdateCredential -> ${JSON.stringify(r)}`, `store=${JSON.stringify(store)}`);
      const ok = r.ok === true && store.dsh.passwordHash === 'NEW_HASH';
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  'svc-restart': {
    check(sandbox, b) {
      const store0 = sandbox.readServiceStore();
      const before = { restartCount: store0.dsh.restartCount, running: store0.dsh.running };
      const r = b.svcUpdateCredential(sandbox, 'NEW_HASH');
      const after = sandbox.readServiceStore().dsh;
      const expected = 'after credential change the service is restarted (restartCount incremented, running=true)';
      const actual = `ok=${r.ok} before=${JSON.stringify(before)} after=${JSON.stringify({ restartCount: after.restartCount, running: after.running })}`;
      sandbox.captured.push(`behavior.svcUpdateCredential -> ${JSON.stringify(r)}`);
      const ok = r.ok === true && after.restartCount === before.restartCount + 1 && after.running === true;
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },

  'svc-failure-safe': {
    check(sandbox, b) {
      sandbox.setServiceFault(true); // next update will fail
      const r = b.svcFailureSafe(sandbox);
      const store = sandbox.readServiceStore();
      const expected = 'on update failure the previous credential is preserved and an error is reported';
      const actual = `ok=${r.ok} credentialPreserved=${r.credentialPreserved} stored=${store.dsh.passwordHash}`;
      sandbox.captured.push(`behavior.svcFailureSafe -> ${JSON.stringify(r)}`, `store=${JSON.stringify(store)}`);
      const ok = r.ok === false && r.credentialPreserved === true && store.dsh.passwordHash === 'OLD_HASH';
      return { ...record(sandbox, expected, actual), status: ok ? 'pass' : 'fail' };
    },
  },
};

/** all files under the sandbox root (relative), excluding fixture stores */
function listFiles(sandbox) {
  const out = [];
  const walk = (rel) => {
    const abs = sandbox.path(rel);
    for (const ent of readdirSync(abs)) {
      if (ent.startsWith('.')) continue; // fixture stores are hidden
      const childRel = rel ? `${rel}/${ent}` : ent;
      if (statSync(sandbox.path(childRel)).isDirectory()) walk(childRel);
      else out.push(childRel);
    }
  };
  if (sandbox.exists('')) walk('');
  return out.sort();
}

/** Build the case list: manifest metadata + Mode A check (or skip). */
export function buildCases() {
  const manifest = loadManifest();
  return manifest.cases.map((meta) => {
    const impl = CHECKS[meta.id];
    return {
      ...meta,
      check: impl ? impl.check : null,
    };
  });
}
