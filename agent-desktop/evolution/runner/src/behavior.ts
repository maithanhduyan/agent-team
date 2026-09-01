/**
 * Deterministic candidate SKILL.md → harness behavior proxy (T12, T14
 * README "Candidate behavior proxy (T12 contract)").
 *
 * The T14 harness executes a **behavior module** (the executable proxy
 * of what the skill-under-test would do) against its Mode A sandbox.
 * A candidate arrives as SKILL.md **text**; this module maps the text
 * to a behavior deterministically, so the SAME suite runs against the
 * base skill (reference behavior) and any candidate (T09 §5.1, ADR-016).
 *
 * Extraction rule (documented, deterministic — CG-1):
 * start from the reference behavior (the base skill's executable
 * encoding) and NAIVE-ify every handling group whose directive is not
 * documented in the candidate text:
 *
 *   - EFS handling: needs EFS/cipher/detect/decrypt guidance
 *     (efs-detect-target, efs-copy-source, efs-cleanup-encrypted).
 *   - Junction handling: needs junction/reparse/resolve/bound/visited
 *     guidance (jct-resolve, jct-traverse, jct-cleanup).
 *   - Service-password handling: needs credential-update + restart +
 *     failure-safe guidance (svc-update-credential, svc-restart,
 *     svc-failure-safe).
 *
 * A candidate that documents the correct handling for a failure class
 * gets the correct behavior for that class; one that dropped it gets
 * the naive (failing) behavior — so the fitness gate + the SEC-GEPA-04
 * regression diff measure exactly what the skill text says to do.
 *
 * NOTE: this is the Mode A **offline proxy** (Windows behaviors are
 * simulated/fixtured, T09 §5.4). Mode B (owner-run Windows Sandbox)
 * is the final merge evidence and uses the identical result schema.
 */

import reference from '../../harness/impl/reference.mjs';

/** Behavior interface the harness executes (reference.mjs shape). */
export type HarnessBehavior = typeof reference;

/** Handling-group directive matchers (case-insensitive, deterministic). */
const EFS_DIRECTIVES = /\b(efs|cipher|encrypt|decrypt)\b/i;
const EFS_DETECT_DIRECTIVES = /\b(detect|check|refuse|stop|attribute)\b/i;
const EFS_COPY_DIRECTIVES = /\b(decrypt|plaintext|ciphertext)\b/i;
const JUNCTION_DIRECTIVES = /\b(junction|reparse|fsutil|link)\b/i;
const JUNCTION_BOUND_DIRECTIVES = /\b(visited|bound|terminate|cycle|depth)\b/i;
const JUNCTION_CLEANUP_DIRECTIVES = /\b(link only|keep|target contents|never the junction target)\b/i;
const SVC_UPDATE_DIRECTIVES = /\b(credential|password|logon)\b/i;
const SVC_RESTART_DIRECTIVES = /\b(restart|sc start|start-service|logon takes effect)\b/i;
const SVC_FAILSAFE_DIRECTIVES = /\b(preserve|failure-safe|previous credential|no partial|lock the service out)\b/i;

function has(text: string, re: RegExp): boolean {
    return re.test(text);
}

/** Naive EFS behavior (mirrors the planted `efs-ignore` mutant). */
function naiveEfs(): Partial<HarnessBehavior> {
    return {
        efsDetectTarget() {
            return { detected: false, message: 'target looks fine' };
        },
        efsCopySource(sandbox: { exists: (r: string) => boolean; mkdir: (r: string) => void; read: (r: string) => string; write: (r: string, c: string) => void }) {
            if (!sandbox.exists('src/data.bin')) {
                return { ok: false, message: 'source missing', dstEncrypted: false };
            }
            sandbox.mkdir('dst');
            sandbox.write('dst/data.bin', sandbox.read('src/data.bin'));
            return { ok: true, message: 'copied', dstEncrypted: true }; // ciphertext kept
        },
        efsCleanup(sandbox: { exists: (r: string) => boolean; isEncrypted: (r: string) => boolean }) {
            let remaining: string[] = [];
            if (sandbox.exists('target/bin/dsh') && sandbox.isEncrypted('target/bin/dsh')) {
                remaining = ['target/bin/dsh'];
            }
            return { ok: remaining.length === 0, message: 'cleanup incomplete', remaining };
        },
    };
}

/** Naive junction behavior (mirrors the planted `junction-naive` mutant). */
function naiveJunction(): Partial<HarnessBehavior> {
    return {
        jctResolve(sandbox: { path: (r: string) => string }) {
            return { resolvedPath: sandbox.path('link'), message: 'not a junction' }; // link kept
        },
        jctTraverse() {
            return { terminated: false, visited: 0, message: 'no bound' };
        },
        jctCleanup(sandbox: { exists: (r: string) => boolean; path: (r: string) => string }) {
            // wrong: deletes the target contents through the link
            return { linkRemoved: sandbox.exists('link'), targetIntact: false, message: 'deleted target contents' };
        },
    };
}

/** Naive service-password behavior (mirrors `svc-no-restart` + no failure-safe). */
function naiveService(): Partial<HarnessBehavior> {
    return {
        svcUpdateCredential(sandbox: {
            readServiceStore: () => { dsh: { passwordHash: string; restartCount: number; running: boolean }; _fault?: boolean };
            writeServiceStore: (v: unknown) => void;
        }, newHash: string) {
            const store = sandbox.readServiceStore();
            if (store._fault) {
                return { ok: false, message: 'credential update failed', updated: false };
            }
            store.dsh.passwordHash = newHash;
            store.dsh.restartCount = store.dsh.restartCount; // no restart
            store.dsh.running = false; // not restarted
            sandbox.writeServiceStore(store);
            return { ok: true, message: 'credential updated (no restart)', updated: true, restarted: false };
        },
        svcFailureSafe(sandbox: {
            readServiceStore: () => { dsh: { passwordHash: string }; _fault?: boolean };
            writeServiceStore: (v: unknown) => void;
        }) {
            // wrong: on failure it still overwrites the credential
            const store = sandbox.readServiceStore();
            store.dsh.passwordHash = 'CORRUPTED_HASH';
            sandbox.writeServiceStore(store);
            return { ok: false, credentialPreserved: false, message: 'credential overwritten on failure' };
        },
    };
}

/**
 * Build the behavior proxy for a candidate SKILL.md text.
 * Deterministic: same text → same behavior (CG-1), so the audit trail
 * can replay the fitness result (SEC-GEPA-11).
 */
export function buildBehaviorFromSkillText(skillText: string): HarnessBehavior {
    const behavior: HarnessBehavior = { ...reference, id: 'candidate-extracted', label: 'candidate SKILL.md (deterministic extraction)' };

    if (!has(skillText, EFS_DIRECTIVES)) {
        Object.assign(behavior, naiveEfs());
    } else {
        // Fine-grained: detection vs copy vs cleanup guidance.
        if (!has(skillText, EFS_DETECT_DIRECTIVES)) {
            behavior.efsDetectTarget = naiveEfs().efsDetectTarget!;
        }
        if (!has(skillText, EFS_COPY_DIRECTIVES)) {
            behavior.efsCopySource = naiveEfs().efsCopySource!;
        }
    }

    if (!has(skillText, JUNCTION_DIRECTIVES)) {
        Object.assign(behavior, naiveJunction());
    } else {
        if (!has(skillText, JUNCTION_BOUND_DIRECTIVES)) {
            behavior.jctTraverse = naiveJunction().jctTraverse!;
        }
        if (!has(skillText, JUNCTION_CLEANUP_DIRECTIVES)) {
            behavior.jctCleanup = naiveJunction().jctCleanup!;
        }
    }

    if (!has(skillText, SVC_UPDATE_DIRECTIVES)) {
        behavior.svcUpdateCredential = naiveService().svcUpdateCredential!;
    } else {
        if (!has(skillText, SVC_RESTART_DIRECTIVES)) {
            behavior.svcUpdateCredential = naiveService().svcUpdateCredential!;
        }
    }
    if (!has(skillText, SVC_FAILSAFE_DIRECTIVES)) {
        behavior.svcFailureSafe = naiveService().svcFailureSafe!;
    }

    return behavior;
}
