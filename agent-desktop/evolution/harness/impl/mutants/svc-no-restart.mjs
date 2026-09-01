/**
 * Planted failure mutant — **svc-no-restart**.
 *
 * Simulates a skill that updates the stored service credential but
 * never restarts the service (the running process keeps the old
 * logon), and is not failure-safe (a failed update corrupts/loses the
 * previous credential). Expected failures: svc-restart,
 * svc-failure-safe (svc-update-credential still passes).
 */
import reference from '../reference.mjs';

export default {
  ...reference,
  id: 'svc-no-restart',
  label: 'mutant: updates credential but never restarts the service',

  svcUpdateCredential(sandbox, newHash) {
    const store = sandbox.readServiceStore();
    if (store._fault) {
      // wrong: a failed update still writes the new hash (partial write)
      store.dsh.passwordHash = 'CORRUPTED';
      sandbox.writeServiceStore(store);
      return { ok: false, message: 'update failed (but store written)', updated: true };
    }
    store.dsh.passwordHash = newHash;
    // wrong: no restart — restartCount unchanged, running left as-is
    sandbox.writeServiceStore(store);
    return { ok: true, message: 'credential updated (service NOT restarted)', updated: true, restarted: false };
  },

  svcFailureSafe(sandbox) {
    // wrong: no rollback on failure
    const result = this.svcUpdateCredential(sandbox, 'NEW_HASH');
    const after = sandbox.readServiceStore().dsh.passwordHash;
    return {
      ok: result.ok,
      credentialPreserved: after === 'OLD_HASH',
      message: 'no rollback attempted',
    };
  },
};
