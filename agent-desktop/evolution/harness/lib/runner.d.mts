/** Type declarations for the T14 harness `lib/runner.mjs` (PR #31). */

import type { HarnessResult } from './fitness.d.mts';

/** The behavior interface the harness executes (reference.mjs shape). */
export interface HarnessBehavior {
    id: string;
    label?: string;
    install(sandbox: unknown): Record<string, unknown>;
    cleanup(sandbox: unknown): Record<string, unknown>;
    efsDetectTarget(sandbox: unknown): Record<string, unknown>;
    efsCopySource(sandbox: unknown): Record<string, unknown>;
    efsCleanup(sandbox: unknown): Record<string, unknown>;
    jctResolve(sandbox: unknown): Record<string, unknown>;
    jctTraverse(sandbox: unknown): Record<string, unknown>;
    jctCleanup(sandbox: unknown): Record<string, unknown>;
    svcUpdateCredential(sandbox: unknown, newHash: string): Record<string, unknown>;
    svcFailureSafe(sandbox: unknown): Record<string, unknown>;
}

export function runSuite(
    behavior: HarnessBehavior,
    opts?: { candidate?: HarnessResult['candidate']; runId?: string | null; startedAt?: string | null },
): HarnessResult;

export const HARNESS_VERSION: string;
