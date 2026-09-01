/**
 * PR metadata (T13, T10 §6.2) — the machine-checkable evidence block that
 * every candidate PR must carry. A PR without it is auto-flagged by the
 * workflow (BR-3: missing metadata = gate fail).
 *
 * Required fields (T10 §6.2 table):
 *   run id + dataset version + dataset sha256 · fitness (SEC-GEPA-02) +
 *   size (SEC-GEPA-03) + regression diff vs base (SEC-GEPA-04) ·
 *   guardrail checklist SEC-GEPA-01..11 (pass/fail + evidence ref) ·
 *   cost report per-model spend WITHOUT keys (SEC-GEPA-09/SEC-COST-02) ·
 *   candidate diff vs base skill.
 *
 * The rendered PR body embeds the metadata as a JSON block delimited by
 * HTML comments (`GEPA-METADATA-BEGIN`/`GEPA-METADATA-END`) so CI can
 * extract + validate it deterministically (auto-flag), plus a
 * human-readable table.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { RunManifest } from '../../runner/src/manifest.js';
import { buildChecklist, type GuardrailChecklist } from './checklist.js';
import { SIZE_LIMIT_BYTES } from './size.js';

export const GEPA_METADATA_BEGIN = '<!-- GEPA-METADATA-BEGIN -->';
export const GEPA_METADATA_END = '<!-- GEPA-METADATA-END -->';

export interface PrMetadata {
    schema_version: 1;
    project: string;
    version: 'v0.5 Skill Evolution';
    skill: string;
    run_id: string;
    dataset: { dataset_id: string; version: string; sha256: string; case_count: number };
    fitness: { score: number; passed: number; total: number; pass: boolean };
    size: { bytes: number; limit: number; pass: boolean };
    regression: { pass: boolean; count: number; base_passed: number; candidate_passed: number };
    guardrails: GuardrailChecklist;
    cost: { month: string; providers: Record<string, { spentUsd: number; capUsd: number; disabled: boolean }> };
    judge: { gate: string; per_model: Record<string, string> };
    candidate_diff: { base_sha256: string; candidate_sha256: string; diff_stat: string };
    branch: string;
    target: string;
}

/** Fields whose presence is REQUIRED for a valid §6.2 metadata block. */
export const REQUIRED_METADATA_FIELDS = [
    'schema_version',
    'project',
    'version',
    'skill',
    'run_id',
    'dataset',
    'fitness',
    'size',
    'regression',
    'guardrails',
    'cost',
    'judge',
    'candidate_diff',
    'branch',
    'target',
] as const;

export function computeSha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Build the §6.2 metadata block for a candidate. */
export function buildPrMetadata(opts: {
    manifest: RunManifest;
    candidate: RunManifest['candidates'][number];
    candidateSkillText: string;
    candidateSha256: string;
    manifestRef: string;
    branch: string;
    target: string;
}): PrMetadata {
    const { manifest, candidate, candidateSkillText, candidateSha256, manifestRef, branch, target } = opts;
    const fitness = candidate.fitness;
    const checklist = buildChecklist({
        manifest,
        candidate,
        candidateSkillText,
        manifestRef,
    });
    return {
        schema_version: 1,
        project: 'agent-desktop',
        version: 'v0.5 Skill Evolution',
        skill: manifest.skill,
        run_id: manifest.run_id,
        dataset: {
            dataset_id: manifest.dataset.dataset_id,
            version: manifest.dataset.dataset_id,
            sha256: manifest.dataset.sha256,
            case_count: manifest.dataset.case_count,
        },
        fitness: {
            score: fitness.fitness,
            passed: fitness.passed,
            total: fitness.total,
            pass: checklist['SEC-GEPA-02']?.pass ?? false,
        },
        size: {
            bytes: candidate.size_bytes,
            limit: SIZE_LIMIT_BYTES,
            pass: checklist['SEC-GEPA-03']?.pass ?? false,
        },
        regression: {
            pass: checklist['SEC-GEPA-04']?.pass ?? false,
            count: fitness.regression?.regressions?.length ?? 0,
            base_passed: fitness.regression?.base_passed ?? 0,
            candidate_passed: fitness.regression?.candidate_passed ?? 0,
        },
        guardrails: checklist,
        cost: {
            month: manifest.judge_cost?.month ?? 'unknown',
            providers: manifest.judge_cost?.providers ?? {},
        },
        judge: {
            gate: candidate.judge?.gate ?? 'unknown',
            per_model: candidate.judge?.per_model ?? {},
        },
        candidate_diff: {
            base_sha256: manifest.base_skill.sha256,
            candidate_sha256: candidateSha256,
            diff_stat: `base ${manifest.base_skill.size_bytes} bytes → candidate ${candidate.size_bytes} bytes (full diff in the PR Files tab)`,
        },
        branch,
        target,
    };
}

/** Render the human-readable PR body with the embedded metadata block. */
export function renderPrBody(opts: {
    metadata: PrMetadata;
    manifestRef: string;
    approvals: { pass: boolean; reason: string };
}): string {
    const { metadata, manifestRef, approvals } = opts;
    const m = metadata;
    const rows = Object.entries(m.guardrails)
        .map(([id, g]) => `| ${id} | ${g.pass ? 'PASS' : 'FAIL'} | ${g.evidence} |`)
        .join('\n');
    const costRows = Object.entries(m.cost.providers)
        .map(([model, p]) => `| ${model} | $${p.spentUsd.toFixed(4)} | $${p.capUsd} | ${p.disabled ? 'disabled (capped)' : 'ok'} |`)
        .join('\n');

    return `${GEPA_METADATA_BEGIN}
${JSON.stringify(m, null, 2)}
${GEPA_METADATA_END}

## Candidate PR — ${m.skill} (${m.version})

Branch \`${m.branch}\` → target \`${m.target}\`. Created by the T13 PR
workflow (SEC-GEPA-06/07: **no auto-merge** — human review required).

### Metadata (T10 §6.2 — machine-checked; missing fields ⇒ gate fail)

| Field | Value |
|---|---|
| Run id | \`${m.run_id}\` |
| Dataset version | \`${m.dataset.version}\` |
| Dataset sha256 | \`${m.dataset.sha256}\` |
| Fitness (SEC-GEPA-02) | ${m.fitness.score} (${m.fitness.passed}/${m.fitness.total}) — ${m.fitness.pass ? 'PASS' : 'FAIL'} |
| Size (SEC-GEPA-03) | ${m.size.bytes} bytes ≤ ${m.size.limit} — ${m.size.pass ? 'PASS' : 'FAIL'} |
| Regression vs base (SEC-GEPA-04) | ${m.regression.count} regression(s) — ${m.regression.pass ? 'PASS' : 'FAIL'} |
| Judge (Q5) | ${m.judge.gate} (${Object.keys(m.judge.per_model).join(', ') || 'no model verdicts'}) |
| Candidate diff vs base | ${m.candidate_diff.diff_stat} |

### Guardrail checklist (SEC-GEPA-01…11 — pass/fail + evidence)

| Guardrail | Pass | Evidence |
|---|---|---|
${rows}

### Cost report (SEC-GEPA-09 / SEC-COST-02 — per-model spend, NO keys)

| Model | Spend | Cap | State |
|---|---|---|---|
${costRows}

### Audit trail (SEC-GEPA-11)

- Run record: \`${manifestRef}\` (this PR links to the run record; the run
  record links back to this PR — AT-3).
- Replayable: dataset hash + harness version + candidate text are
  recorded, so T15/T19 can re-derive fitness (AT-2).

### Human review (SEC-GEPA-06)

${approvals.pass ? approvals.reason : '⛔ ' + approvals.reason}

> Merge is a **manual human action** (owner + cto approvals recorded on
> this PR). No automated merge (SEC-GEPA-07); no activation before merge
> + approval (SEC-GEPA-05).
`;
}

/**
 * Extract + validate the metadata block from a PR body.
 * Returns the missing/invalid fields — non-empty ⇒ auto-flag (BR-3).
 */
export function checkPrMetadataBody(body: string): {
    pass: boolean;
    metadata: PrMetadata | null;
    missing: string[];
    invalid: string[];
} {
    const begin = body.indexOf(GEPA_METADATA_BEGIN);
    const end = body.indexOf(GEPA_METADATA_END);
    if (begin < 0 || end < 0 || end <= begin) {
        return {
            pass: false,
            metadata: null,
            missing: ['GEPA-METADATA block'],
            invalid: [],
        };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(body.slice(begin + GEPA_METADATA_BEGIN.length, end)) as unknown;
    } catch {
        return { pass: false, metadata: null, missing: [], invalid: ['GEPA-METADATA block is not valid JSON'] };
    }
    const meta = parsed as Partial<PrMetadata>;
    const missing = REQUIRED_METADATA_FIELDS.filter((f) => meta[f] === undefined);

    const invalid: string[] = [];
    if (meta.size && typeof meta.size.bytes === 'number' && meta.size.bytes > SIZE_LIMIT_BYTES) {
        invalid.push(`size ${meta.size.bytes} > ${SIZE_LIMIT_BYTES} (SEC-GEPA-03)`);
    }
    if (meta.fitness && meta.fitness.pass !== true) invalid.push('fitness < 100% (SEC-GEPA-02)');
    if (meta.regression && meta.regression.pass !== true) invalid.push('regression vs base (SEC-GEPA-04)');
    if (meta.guardrails) {
        const failed = Object.values(meta.guardrails).filter((g) => g && g.pass !== true);
        if (failed.length > 0) invalid.push(`${failed.length} guardrail(s) not PASS`);
    }

    return { pass: missing.length === 0 && invalid.length === 0, metadata: meta as PrMetadata, missing, invalid };
}

/** CLI: `... check-metadata <pr-body.md>` — exit 0 iff all §6.2 fields present+valid. */
export function checkMetadataCli(bodyPath: string): number {
    const body = readFileSync(bodyPath, 'utf8');
    const r = checkPrMetadataBody(body);
    // eslint-disable-next-line no-console
    console.log(
        `PR metadata check (T10 §6.2): ${r.pass ? 'PASS' : 'FAIL'} ` +
            `missing=${r.missing.join(',') || 'none'} invalid=${r.invalid.join(',') || 'none'}`,
    );
    return r.pass ? 0 : 1;
}
