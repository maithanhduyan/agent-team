/**
 * T13 workflow tests — PR metadata (T10 §6.2) + auto-flag (BR-3).
 *
 * A candidate PR MUST carry the full metadata block: run id + dataset
 * version + dataset sha256 · fitness (SEC-GEPA-02) · size (SEC-GEPA-03)
 * · regression diff vs base (SEC-GEPA-04) · guardrail checklist
 * SEC-GEPA-01..11 (pass/fail + evidence ref) · cost report per-model
 * spend WITHOUT keys (SEC-GEPA-09/SEC-COST-02) · candidate diff vs
 * base. Missing metadata ⇒ auto-flag (gate fail).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    buildPrMetadata,
    renderPrBody,
    checkPrMetadataBody,
    REQUIRED_METADATA_FIELDS,
    GEPA_METADATA_BEGIN,
    GEPA_METADATA_END,
} from '../src/metadata.js';
import { loadRunManifest, findCandidate, resolveManifestPath } from '../src/open-pr.js';
import { checkApprovals } from '../src/review.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MANIFEST = resolve(FIXTURES, 'manifest-merge-ready.json');
const CANDIDATE = resolve(FIXTURES, 'candidates/gen0-01/SKILL.md');

function metadataFor(manifestPath = MANIFEST): ReturnType<typeof buildPrMetadata> {
    const { manifest, ref } = loadRunManifest(manifestPath);
    const candidate = findCandidate(manifest, 'gen0-01');
    const skillText = readFileSync(
        resolveManifestPath(manifestPath, candidate.skill_path ?? 'candidates/gen0-01/SKILL.md'),
        'utf8',
    );
    return buildPrMetadata({
        manifest,
        candidate,
        candidateSkillText: skillText,
        candidateSha256: '7052714ffceacece9c76eea0c67f0862d58a3d9c70f963852a91e230c2ec313a',
        manifestRef: ref,
        branch: 'evolution/install-dsh/evo_20260901_001-gen0-01',
        target: 'develop',
    });
}

test('metadata: all §6.2 fields are present (T10 §6.2 table)', () => {
    const m = metadataFor();
    for (const f of REQUIRED_METADATA_FIELDS) {
        assert.ok(m[f] !== undefined, `missing required metadata field: ${f}`);
    }
    assert.equal(m.run_id, 'evo_20260901_001');
    assert.equal(m.dataset.version, 'install-dsh-v0.1');
    assert.match(m.dataset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(m.fitness.pass, true);
    assert.equal(m.size.pass, true);
    assert.equal(m.size.bytes, 3802);
    assert.equal(m.regression.pass, true);
    assert.equal(m.regression.count, 0);
});

test('metadata: guardrail checklist covers SEC-GEPA-01..11 with pass/fail + evidence', () => {
    const m = metadataFor();
    const ids = Object.keys(m.guardrails).sort();
    assert.deepEqual(ids, Array.from({ length: 11 }, (_, i) => `SEC-GEPA-${String(i + 1).padStart(2, '0')}`));
    for (const g of Object.values(m.guardrails)) {
        assert.equal(typeof g.pass, 'boolean');
        assert.ok(typeof g.evidence === 'string' && g.evidence.length > 0, `missing evidence for ${g.id}`);
    }
});

test('metadata: cost report has per-model spend and NO keys (SEC-GEPA-09/SEC-COST-02)', () => {
    const m = metadataFor();
    assert.ok(m.cost.providers.deepseek);
    assert.equal(typeof m.cost.providers.deepseek.spentUsd, 'number');
    assert.equal(m.cost.providers.deepseek.capUsd, 15);
    const serialized = JSON.stringify(m.cost);
    assert.ok(!/sk-|AIza|DEEPSEEK_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|token=/.test(serialized));
});

test('metadata: rendered PR body embeds the machine-readable metadata block', () => {
    const m = metadataFor();
    const approvals = checkApprovals([], { roleMap: { owner: ['maithanhduyan'], cto: ['cto'] } });
    const body = renderPrBody({ metadata: m, manifestRef: MANIFEST, approvals });
    assert.ok(body.includes(GEPA_METADATA_BEGIN));
    assert.ok(body.includes(GEPA_METADATA_END));
    assert.ok(body.includes('SEC-GEPA-01'));
    assert.ok(body.includes('Guardrail checklist'));
    assert.ok(body.includes('Cost report'));
    assert.ok(body.includes('no auto-merge'));
});

test('auto-flag: a body with the full metadata block passes the check', () => {
    const m = metadataFor();
    const approvals = checkApprovals([], { roleMap: { owner: ['maithanhduyan'], cto: ['cto'] } });
    const body = renderPrBody({ metadata: m, manifestRef: MANIFEST, approvals });
    const r = checkPrMetadataBody(body);
    assert.equal(r.pass, true, `missing=${r.missing} invalid=${r.invalid}`);
    assert.equal(r.metadata?.run_id, 'evo_20260901_001');
});

test('auto-flag: a body WITHOUT the metadata block is flagged (BR-3 gate fail)', () => {
    const r = checkPrMetadataBody('# Candidate PR\n\nNo metadata here.\n');
    assert.equal(r.pass, false);
    assert.ok(r.missing.includes('GEPA-METADATA block'));
});

test('auto-flag: metadata with size > 15 KB is invalid (SEC-GEPA-03)', () => {
    const m = metadataFor();
    m.size = { bytes: 20_000, limit: 15360, pass: false };
    const approvals = checkApprovals([], { roleMap: { owner: ['maithanhduyan'], cto: ['cto'] } });
    const body = renderPrBody({ metadata: m, manifestRef: MANIFEST, approvals });
    const r = checkPrMetadataBody(body);
    assert.equal(r.pass, false);
    assert.ok(r.invalid.some((i) => i.includes('SEC-GEPA-03')));
});

test('auto-flag: metadata with a failed guardrail is invalid', () => {
    const m = metadataFor();
    m.guardrails['SEC-GEPA-04'] = { id: 'SEC-GEPA-04', pass: false, evidence: 'regression found', source: 'recomputed' };
    const approvals = checkApprovals([], { roleMap: { owner: ['maithanhduyan'], cto: ['cto'] } });
    const body = renderPrBody({ metadata: m, manifestRef: MANIFEST, approvals });
    const r = checkPrMetadataBody(body);
    assert.equal(r.pass, false);
    assert.ok(r.invalid.some((i) => i.includes('guardrail')));
});
