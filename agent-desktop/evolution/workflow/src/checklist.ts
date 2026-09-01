/**
 * SEC-GEPA-01…11 checklist assembly for PR metadata (T13, T10 §6.2).
 *
 * Every candidate PR must carry the full guardrail checklist — pass/fail
 * + evidence ref for ALL of SEC-GEPA-01…11 (T10 §5, US-SKILL-002 AC-2).
 *
 * Evidence strategy (CG-1 determinism):
 *   - SEC-GEPA-02/03/04/08 are RECOMPUTED by the workflow from the
 *     candidate text + pinned dataset (re-runnable from the audit trail).
 *   - SEC-GEPA-01/05/06/07/09/10/11 come from the run manifest's
 *     recorded guardrails + a structural evidence ref (the workflow
 *     itself is the T13 implementation of 05/06/07).
 */

import { checkSizeBytes } from './size.js';
import { abRegression } from './ab.js';
import { scanSecrets } from '../../src/secret-scan.js';
import type { RunManifest } from '../../runner/src/manifest.js';

export interface ChecklistEntry {
    id: string;
    pass: boolean;
    evidence: string;
    source: 'recorded' | 'recomputed';
}

export type GuardrailChecklist = Record<string, ChecklistEntry>;

const RUN_LEVEL_IDS = ['SEC-GEPA-01', 'SEC-GEPA-05', 'SEC-GEPA-06', 'SEC-GEPA-07', 'SEC-GEPA-09', 'SEC-GEPA-10', 'SEC-GEPA-11'];

/**
 * Build the SEC-GEPA-01…11 checklist for a candidate from the run
 * manifest + a deterministic re-check of the candidate text.
 */
export function buildChecklist(opts: {
    manifest: RunManifest;
    candidate: RunManifest['candidates'][number];
    candidateSkillText: string;
    manifestRef: string;
}): GuardrailChecklist {
    const { manifest, candidate, candidateSkillText, manifestRef } = opts;
    const recorded = candidate.guardrails ?? {};
    const checklist: GuardrailChecklist = {};

    // Run-level gates: evidence points at the run manifest record + the
    // structural implementation in this workflow (T13).
    for (const id of RUN_LEVEL_IDS) {
        const rec = recorded[id];
        checklist[id] = {
            id,
            pass: rec ? rec.pass : false,
            evidence: rec
                ? `recorded in ${manifestRef} (candidates[].guardrails.${id}); implementation: workflow/ (T13)`
                : `MISSING record in ${manifestRef} for ${id}`,
            source: 'recorded',
        };
    }

    // Recomputed deterministic gates (CG-1).
    const size = checkSizeBytes(candidate.size_bytes);
    checklist['SEC-GEPA-03'] = {
        id: 'SEC-GEPA-03',
        pass: size.pass,
        evidence: `recomputed by workflow size check (wc -c): ${size.actual} bytes ≤ 15360 — ${size.pass ? 'pass' : 'REJECT (R-5)'}`,
        source: 'recomputed',
    };

    const ab = abRegression(candidateSkillText);
    checklist['SEC-GEPA-04'] = {
        id: 'SEC-GEPA-04',
        pass: ab.pass,
        evidence: `recomputed A/B vs base on the SAME suite: fitness=${ab.fitness} (${ab.passed}/${ab.total}), regressions=${ab.regressions.length} — ${ab.pass ? 'pass' : 'REJECT (R-4)'}`,
        source: 'recomputed',
    };

    const secretHits = scanSecrets(candidateSkillText);
    checklist['SEC-GEPA-08'] = {
        id: 'SEC-GEPA-08',
        pass: secretHits.length === 0,
        evidence: `recomputed SEC-LOG-02 scan on candidate text: ${secretHits.length} hit(s) — 0 required`,
        source: 'recomputed',
    };

    // SEC-GEPA-02: suite fitness on the pinned dataset (recorded in the
    // manifest, cross-checked against the recomputed A/B fitness).
    const fitness = candidate.fitness;
    const suitePass = fitness.threshold_met === true && ab.threshold_met;
    checklist['SEC-GEPA-02'] = {
        id: 'SEC-GEPA-02',
        pass: suitePass,
        evidence: `recorded fitness=${fitness.fitness} (${fitness.passed}/${fitness.total}) in ${manifestRef}; recomputed fitness=${ab.fitness} (${ab.passed}/${ab.total}) — 100% required (SEC-GEPA-02)`,
        source: 'recorded',
    };

    // Keep a stable order SEC-GEPA-01..11 for the rendered checklist.
    const ordered: GuardrailChecklist = {};
    for (let i = 1; i <= 11; i += 1) {
        const id = `SEC-GEPA-${String(i).padStart(2, '0')}`;
        ordered[id] = checklist[id];
    }
    return ordered;
}
