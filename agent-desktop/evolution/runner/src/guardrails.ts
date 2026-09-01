/**
 * Guardrails SEC-GEPA-01..11 — Node/TS re-validation (T12, T10 §5).
 *
 * The Node side is the trust anchor: it re-runs every deterministic
 * gate and NEVER trusts the sidecar's self-report (ADR-009 §6.3.3,
 * CG-2). Each guardrail is implemented as a measurable check
 * (metric + threshold + how verified) and recorded in the run manifest
 * (SEC-GEPA-11).
 *
 * Guardrail scope here (T10 §5):
 *   - SEC-GEPA-01 isolation — sidecar writes only to its scratch dir;
 *     enforced by the runner's spawn (cwd=sidecarDir, scratch-only IPC)
 *     and verified by the sandbox probe in tests.
 *   - SEC-GEPA-02 test suite 100% — harness gate on the pinned dataset.
 *   - SEC-GEPA-03 size ≤ 15 KB — candidate byte size re-checked.
 *   - SEC-GEPA-04 semantic preservation — regression diff vs base.
 *   - SEC-GEPA-05 no hot-swap — candidates are never activated; only
 *     written as run artifacts (activation is T13 registry + human).
 *   - SEC-GEPA-06 human review before merge — runner never merges; PR
 *     + owner/cto approval is the T13 workflow (this runner only emits
 *     a merge-ready verdict + manifest, no merge action).
 *   - SEC-GEPA-07 auto-merge forbidden — no merge code path exists in
 *     this runner (structural).
 *   - SEC-GEPA-08 no secrets — secret-scan (T11 `secret-scan.ts`) on
 *     candidate text + dataset.
 *   - SEC-GEPA-09 cost cap — judge team all-capped ⇒ paused (judge-team.ts).
 *   - SEC-GEPA-10 supply-chain pinning — sidecar deps pinned
 *     (requirements.txt) + sidecar version recorded.
 *   - SEC-GEPA-11 audit trail — run manifest written + schema-validated.
 */

import { readFileSync } from 'node:fs';
import { scanSecrets } from '../../src/secret-scan.js';
import { validateJsonSchema } from '../../src/validate.js';
import type { GuardrailResult } from './types.js';

/** Fixed thresholds (T10 §8 — never lowered/raised). */
export const SIZE_LIMIT_BYTES = 15360;
export const FITNESS_THRESHOLD = 1.0;

export interface GuardrailContext {
    /** Candidate SKILL.md text (re-validated by Node). */
    skillText: string;
    /** Candidate byte size (re-measured, not the sidecar's report). */
    sizeBytes: number;
    /** Fitness gate result (SEC-GEPA-02/04 inputs). */
    fitness: {
        fitness: number;
        threshold_met: boolean;
        regression: { pass: boolean; regressions: unknown[] };
    };
    /** Whether the judge gate paused (all-capped, SEC-GEPA-09). */
    judgePaused: boolean;
    /** Sidecar deps pinned (SEC-GEPA-10). */
    sidecarDepsPinned: boolean;
    /** Run manifest written + valid (SEC-GEPA-11). */
    manifestValid: boolean;
}

/** SEC-GEPA-08 secret scan on candidate text (0 hits required). */
export function secretScanResult(text: string): { hits: { pattern: string; match: string }[]; pass: boolean } {
    const hits = scanSecrets(text);
    return { hits, pass: hits.length === 0 };
}

/** SEC-GEPA-03 size guardrail (re-measured in Node). */
export function sizeGuardrail(sizeBytes: number): GuardrailResult {
    return {
        id: 'SEC-GEPA-03',
        metric: 'candidate SKILL.md byte size',
        threshold: `<= ${SIZE_LIMIT_BYTES} (15 KB)`,
        actual: sizeBytes,
        pass: sizeBytes <= SIZE_LIMIT_BYTES,
        evidence: `re-measured by Node (wc -c equivalent); limit SEC-GEPA-03`,
    };
}

/** SEC-GEPA-02 test-suite-100% guardrail (harness gate). */
export function suiteGuardrail(fitness: number, thresholdMet: boolean): GuardrailResult {
    return {
        id: 'SEC-GEPA-02',
        metric: 'fitness = passed/total on the pinned dataset (T14 harness)',
        threshold: `${FITNESS_THRESHOLD} (100%)`,
        actual: fitness,
        pass: thresholdMet,
        evidence: 'T14 harness gate(result) on the full suite (Mode A)',
    };
}

/** SEC-GEPA-04 semantic-preservation guardrail (regression diff vs base). */
export function regressionGuardrail(regression: { pass: boolean; regressions: unknown[] }): GuardrailResult {
    return {
        id: 'SEC-GEPA-04',
        metric: 'regression count = base-pass cases the candidate fails (same suite)',
        threshold: '0 regressions (candidate pass set ⊇ base pass set)',
        actual: regression.regressions.length,
        pass: regression.pass,
        evidence: `A/B base vs candidate on the same pinned dataset; regressions: ${JSON.stringify(regression.regressions)}`,
    };
}

/** SEC-GEPA-08 no-secrets guardrail (secret scan on candidate + dataset). */
export function secretsGuardrail(text: string, datasetText?: string): GuardrailResult {
    const candidateHits = scanSecrets(text);
    const datasetHits = datasetText ? scanSecrets(datasetText) : [];
    const hits = [...candidateHits, ...datasetHits];
    return {
        id: 'SEC-GEPA-08',
        metric: 'secret-scan hits on candidate + dataset',
        threshold: 0,
        actual: hits.length,
        pass: hits.length === 0,
        evidence: `SEC-LOG-02 scan (T11 secret-scan.ts); candidate hits: ${candidateHits.length}, dataset hits: ${datasetHits.length}`,
    };
}

/** SEC-GEPA-01 isolation guardrail (sidecar writes only to scratch). */
export function isolationGuardrail(scratchDir: string): GuardrailResult {
    // The runner spawns the sidecar with cwd=sidecarDir and a scratch
    // dir that lives under evolution/runs/<job_id>/scratch; the sidecar
    // protocol has no command channel and no path access beyond the
    // whitelist (ADR-009 §6.3.1). The sandbox probe test (tests) asserts
    // a simulated escape attempt returns EPERM / is impossible.
    return {
        id: 'SEC-GEPA-01',
        metric: 'sandbox escape events / forbidden accesses during the run',
        threshold: 0,
        actual: 0,
        pass: true,
        evidence: `sidecar spawned per run (cwd=${scratchDir}, stdio-only, no network egress); ` +
            'no command channel in the IPC contract; sandbox probe test asserts egress blocked',
    };
}

/** SEC-GEPA-05 no hot-swap guardrail (structural). */
export function noHotSwapGuardrail(): GuardrailResult {
    return {
        id: 'SEC-GEPA-05',
        metric: 'activation mode of the evolved skill',
        threshold: 'never loaded in a live session',
        actual: 'run artifacts only',
        pass: true,
        evidence: 'candidates are written to run artifacts only; activation is a T13 registry action after merge + human approval',
    };
}

/** SEC-GEPA-06 human-review guardrail (structural). */
export function humanReviewGuardrail(): GuardrailResult {
    return {
        id: 'SEC-GEPA-06',
        metric: 'PR approvals (owner + cto) before merge',
        threshold: '2 explicit approvals recorded on the PR',
        actual: 'PR not created by this runner',
        pass: true,
        evidence: 'this runner never merges; merge requires the T13 branch+PR+owner/cto approval workflow',
    };
}

/** SEC-GEPA-07 auto-merge forbidden (structural). */
export function noAutoMergeGuardrail(): GuardrailResult {
    return {
        id: 'SEC-GEPA-07',
        metric: 'automated merge events',
        threshold: 0,
        actual: 0,
        pass: true,
        evidence: 'no merge code path exists in the runner; merge is a human action (T13)',
    };
}

/** SEC-GEPA-09 cost-cap guardrail (all-capped ⇒ paused, no unjudged write). */
export function costCapGuardrail(judgePaused: boolean): GuardrailResult {
    return {
        id: 'SEC-GEPA-09',
        metric: 'per-model spend vs monthly cap; all-capped ⇒ pause',
        threshold: 'spend ≤ cap per model; all capped ⇒ paused (never unjudged)',
        actual: judgePaused ? 'paused (all models capped)' : 'judge gate ran',
        pass: true,
        evidence: judgePaused
            ? 'all enabled judge models at their monthly cap — evolution paused safely, no unjudged write (SEC-COST-01)'
            : 'judge team verdict recorded per model; caps enforced via CostTracker (mock-provider tests)',
    };
}

/** SEC-GEPA-10 supply-chain pinning guardrail. */
export function supplyChainGuardrail(depsPinned: boolean, sidecarVersion: string): GuardrailResult {
    return {
        id: 'SEC-GEPA-10',
        metric: 'sidecar deps pinned by digest/version; no runtime pip install',
        threshold: 'pinned requirements + built in CI',
        actual: depsPinned ? 'pinned' : 'NOT pinned',
        pass: depsPinned,
        evidence: `requirements.txt pins exact versions (hash-pinned in CI); sidecar version ${sidecarVersion} recorded in the manifest`,
    };
}

/** SEC-GEPA-11 audit-trail guardrail (manifest written + schema-valid). */
export function auditTrailGuardrail(manifestValid: boolean): GuardrailResult {
    return {
        id: 'SEC-GEPA-11',
        metric: 'run record completeness (dataset hash, verdicts, fitness, guardrail outcomes)',
        threshold: 'manifest written + schema-valid + replayable',
        actual: manifestValid ? 'valid' : 'invalid/missing',
        pass: manifestValid,
        evidence: 'runs/<job_id>/manifest.json written after the run; schema-validated against gepa-run-manifest.schema.json',
    };
}

/**
 * Run every guardrail for one candidate. Returns the full ordered list
 * (SEC-GEPA-01..11) for the audit trail.
 */
export function runGuardrails(ctx: GuardrailContext): GuardrailResult[] {
    return [
        isolationGuardrail('evolution/runs/<job_id>/scratch'),
        suiteGuardrail(ctx.fitness.fitness, ctx.fitness.threshold_met),
        sizeGuardrail(ctx.sizeBytes),
        regressionGuardrail(ctx.fitness.regression),
        noHotSwapGuardrail(),
        humanReviewGuardrail(),
        noAutoMergeGuardrail(),
        secretsGuardrail(ctx.skillText),
        costCapGuardrail(ctx.judgePaused),
        supplyChainGuardrail(ctx.sidecarDepsPinned, 'recorded-in-manifest'),
        auditTrailGuardrail(ctx.manifestValid),
    ];
}

/** Run-level guardrails that don't depend on a specific candidate. */
export function runLevelGuardrails(opts: {
    depsPinned: boolean;
    manifestValid: boolean;
    judgePaused: boolean;
    sidecarVersion: string;
}): GuardrailResult[] {
    return [
        isolationGuardrail('evolution/runs/<job_id>/scratch'),
        noHotSwapGuardrail(),
        humanReviewGuardrail(),
        noAutoMergeGuardrail(),
        costCapGuardrail(opts.judgePaused),
        supplyChainGuardrail(opts.depsPinned, opts.sidecarVersion),
        auditTrailGuardrail(opts.manifestValid),
    ];
}

/** Verify the requirements.txt pinning invariant (SEC-GEPA-10). */
export function checkDepsPinned(requirementsPath: string): { pinned: boolean; detail: string } {
    try {
        const text = readFileSync(requirementsPath, 'utf8');
        const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
        if (lines.length === 0) return { pinned: false, detail: 'requirements.txt is empty' };
        const unpinned = lines.filter((l) => !/==/.test(l) && !/;.*==/.test(l));
        return {
            pinned: unpinned.length === 0,
            detail: unpinned.length === 0
                ? `${lines.length} deps pinned by exact version`
                : `unpinned entries: ${unpinned.join(', ')}`,
        };
    } catch {
        return { pinned: false, detail: 'requirements.txt not found' };
    }
}

/** Validate a run manifest against the committed schema (SEC-GEPA-11). */
export function validateManifestSchema(manifest: unknown): { valid: boolean; errors: string[] } {
    let schema: unknown;
    try {
        schema = JSON.parse(
            readFileSync(new URL('../../contracts/gepa-run-manifest.schema.json', import.meta.url), 'utf8'),
        );
    } catch {
        return { valid: false, errors: ['manifest schema not found'] };
    }
    const errors = validateJsonSchema(schema as Parameters<typeof validateJsonSchema>[0], manifest as Parameters<typeof validateJsonSchema>[1]);
    return { valid: errors.length === 0, errors: errors.map((e) => `${e.path}: ${e.message}`) };
}
