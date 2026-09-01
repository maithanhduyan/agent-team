/**
 * T11 eval dataset builder — test suite (TASK-8866 / Redmine #44).
 *
 * Covers the T10 §4 acceptance contract: SRC-1..3 (provenance),
 * FMT-1..5 (format + dedup), COV-1..3 (coverage + immutability),
 * QL-1..3 / SEC-GEPA-08 (no secrets), plus the CLI contract.
 *
 * Run: cd agent-desktop && node --import tsx --test evolution/test/*.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
    assembleDataset,
    assertDatasetOutputPath,
    BuildError,
    computeSha256,
    dedupKey,
    loadJson,
    loadJsonLines,
    redactRecord,
    serializeDataset,
    validateRecordShape,
    verifyErrorLogSource,
    verifySandboxSource,
    type CaseCuration,
    type DatasetRecord,
    type ErrorLogCase,
    type HarnessManifest,
    type SandboxResults,
} from '../src/dataset.js';
import { scanJsonValue, scanSecrets } from '../src/secret-scan.js';
import { validateJsonSchema } from '../src/validate.js';

const execFileP = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const EVO = join(REPO_ROOT, 'agent-desktop/evolution');
const AGENT_DESKTOP = join(REPO_ROOT, 'agent-desktop');

function loadFixtureInputs() {
    const manifest = loadJson<HarnessManifest>(join(EVO, 'fixtures/sandbox/manifest.json'), 'manifest');
    const results = loadJson<SandboxResults>(join(EVO, 'fixtures/sandbox/results/mode-a.json'), 'results');
    const caseCurations = loadJsonLines<CaseCuration>(join(EVO, 'fixtures/sandbox/case-curation.jsonl'), 'curation');
    const errorLogCases = loadJsonLines<ErrorLogCase>(join(EVO, 'fixtures/logs/error-log-cases.jsonl'), 'log cases');
    return { manifest, results, caseCurations, errorLogCases };
}

const BUILT_AT = '2026-09-01T00:00:00.000Z';

function buildFixture(opts: { extraCurations?: CaseCuration[]; extraLogCases?: ErrorLogCase[] } = {}) {
    const inputs = loadFixtureInputs();
    return assembleDataset(
        {
            manifest: inputs.manifest,
            results: inputs.results,
            caseCurations: [...inputs.caseCurations, ...(opts.extraCurations ?? [])],
            errorLogCases: [...inputs.errorLogCases, ...(opts.extraLogCases ?? [])],
        },
        { rootDir: REPO_ROOT, datasetId: 'install-dsh-v0.1', skill: 'install-dsh', builtAt: BUILT_AT },
    );
}

function sampleRecord(overrides: Partial<DatasetRecord> = {}): DatasetRecord {
    return {
        id: 'EVAL-install-dsh-999',
        context: 'context text',
        error: 'error text',
        fix: 'correct handling text',
        scenario: 'efs',
        source: { type: 'sandbox_test', ref: 'ID-INSTALL-DSH-007', harness_version: '0.1.0' },
        severity: 'major',
        verified: 'sandbox-pass',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// FMT-1..4 — record shape + schema validation
// ---------------------------------------------------------------------------

test('FMT-1: fix = "retry" is rejected', () => {
    assert.throws(
        () => validateRecordShape(sampleRecord({ fix: 'retry' })),
        (e: BuildError) => e.details.some((d) => d.includes('not just "retry"')),
    );
    assert.throws(
        () => validateRecordShape(sampleRecord({ fix: '  just retry ' })),
        (e: BuildError) => e.details.some((d) => d.includes('not just "retry"')),
    );
});

test('FMT-1: context/error/fix must all be non-empty', () => {
    assert.throws(() => validateRecordShape(sampleRecord({ context: '' })), /FMT-1/);
    assert.throws(() => validateRecordShape(sampleRecord({ error: '' })), /FMT-1/);
    assert.throws(() => validateRecordShape(sampleRecord({ fix: '' })), /FMT-1/);
});

test('FMT-3: invalid verified value is rejected', () => {
    assert.throws(
        () => validateRecordShape(sampleRecord({ verified: 'unverified' as never })),
        (e: BuildError) => e.details.some((d) => d.includes('invalid verified')),
    );
});

test('FMT-4: records validate against contracts/eval-dataset.schema.json (definitions.record)', () => {
    const schema = loadJson<{ definitions: { record: unknown } }>(
        join(EVO, 'contracts/eval-dataset.schema.json'),
        'schema',
    );
    assert.equal(validateJsonSchema(schema.definitions.record as never, sampleRecord(), schema as never).length, 0);
    const missing = sampleRecord();
    delete (missing as Partial<DatasetRecord>).fix;
    const errs = validateJsonSchema(schema.definitions.record as never, missing, schema as never);
    assert.ok(errs.some((e) => e.message.includes('fix')), `expected missing-fix error, got ${JSON.stringify(errs)}`);
    const extra = { ...sampleRecord(), bogus: 1 } as unknown as DatasetRecord;
    const errs2 = validateJsonSchema(schema.definitions.record as never, extra, schema as never);
    assert.ok(errs2.some((e) => e.message.includes('bogus')), 'additional property must be rejected');
});

test('FMT-4: dataset envelope validates against the root schema', () => {
    const built = buildFixture();
    const schema = loadJson(join(EVO, 'contracts/eval-dataset.schema.json'), 'schema');
    const errs = validateJsonSchema(schema, built.dataset as never, schema as never);
    assert.deepEqual(errs, []);
});

// ---------------------------------------------------------------------------
// SRC-1..3 — provenance
// ---------------------------------------------------------------------------

test('SRC-1: sandbox case id not in the T14 manifest is rejected at build time', () => {
    const inputs = loadFixtureInputs();
    const bad: CaseCuration = {
        case_id: 'ID-NOT-IN-MANIFEST',
        context: 'x',
        error: 'y',
        fix: 'z',
        scenario: 'efs',
        severity: 'major',
    };
    assert.throws(
        () => verifySandboxSource(bad, inputs.manifest, inputs.results),
        (e: BuildError) => e.stage === 'source' && /not in the T14 manifest/.test(e.message),
    );
});

test('SRC-1: error_log ref to a missing file is rejected at build time', () => {
    const bad: ErrorLogCase = {
        ref: 'does/not/exist.log:1',
        context: 'x',
        error: 'y',
        fix: 'z',
        scenario: 'efs',
        severity: 'major',
        verified: 'human-confirmed',
    };
    assert.throws(() => verifyErrorLogSource(bad, REPO_ROOT), (e: BuildError) => e.stage === 'source');
});

test('SRC-1: error_log ref with invalid format or out-of-range line is rejected', () => {
    const inputs = loadFixtureInputs();
    assert.throws(
        () => verifyErrorLogSource({ ...inputs.errorLogCases[0], ref: 'not-a-ref' }, REPO_ROOT),
        /not <file>:<line>/,
    );
    assert.throws(
        () => verifyErrorLogSource({ ...inputs.errorLogCases[0], ref: 'agent-desktop/evolution/fixtures/logs/dsh-run.log:999' }, REPO_ROOT),
        /out of range/,
    );
});

test('SRC-2: error_log error must be quoted exactly from the referenced line', () => {
    const inputs = loadFixtureInputs();
    const paraphrased: ErrorLogCase = {
        ...inputs.errorLogCases[0],
        error: 'CopyFileEx failed with a privilege error (paraphrased)',
    };
    assert.throws(
        () => verifyErrorLogSource(paraphrased, REPO_ROOT),
        (e: BuildError) => e.stage === 'source' && /not quoted exactly/.test(e.message),
    );
});

test('SRC-2: sandbox curation error must match the captured failure exactly', () => {
    const inputs = loadFixtureInputs();
    const curation = inputs.caseCurations.find((c) => c.case_id === 'ID-INSTALL-DSH-007')!;
    assert.throws(
        () => verifySandboxSource({ ...curation, error: 'some other message' }, inputs.manifest, inputs.results),
        /does not match the captured failure exactly/,
    );
});

test('SRC-3: results harness_version must match the manifest', () => {
    const inputs = loadFixtureInputs();
    const results: SandboxResults = { ...inputs.results, harness_version: '9.9.9' };
    assert.throws(
        () => verifySandboxSource(inputs.caseCurations[0], inputs.manifest, results),
        /harness_version/,
    );
});

test('SRC-1 + FMT-3: a failed case with no error or an unverified fix case is rejected', () => {
    const inputs = loadFixtureInputs();
    const failed = inputs.caseCurations.find((c) => c.case_id === 'ID-INSTALL-DSH-007')!;
    assert.throws(
        () => verifySandboxSource({ ...failed, error: '' }, inputs.manifest, inputs.results),
        /failed but curation has no error/,
    );
    // fix_case_id pointing at a failing test ⇒ fix not verified (FMT-3).
    assert.throws(
        () => verifySandboxSource({ ...failed, fix_case_id: 'ID-INSTALL-DSH-014' }, inputs.manifest, inputs.results),
        /fix is not verified/,
    );
});

// ---------------------------------------------------------------------------
// FMT-5 — dedup
// ---------------------------------------------------------------------------

test('FMT-5: dedup key normalizes whitespace and case', () => {
    assert.equal(dedupKey('  a b ', 'ERR X'), dedupKey('a  b', 'err x'));
    assert.notEqual(dedupKey('a b', 'ERR X'), dedupKey('a b', 'ERR Y'));
});

test('FMT-5: duplicate (context, error) pairs are removed and counted in the report', () => {
    const dup: ErrorLogCase = {
        ref: 'agent-desktop/evolution/fixtures/logs/dsh-run.log:8',
        context: 'Install under AppData\\Roaming\\dsh (a junction to C:\\tools\\dsh); the copier followed the junction during copy',
        error: 'install-dsh: warning: junction C:\\Users\\owner\\AppData\\Roaming\\dsh -> C:\\tools\\dsh followed during copy; files landed on the wrong target',
        fix: 'Resolve junctions for every path component before choosing the install root and copy only to the resolved target path.',
        scenario: 'junction',
        severity: 'major',
        verified: 'human-confirmed',
    };
    const built = buildFixture({ extraLogCases: [dup] });
    assert.equal(built.report.dedup.duplicates_removed, 2); // fixture dup + this dup
    assert.equal(built.dataset.case_count, 24); // 25 input - 1 dup (extra dup collides with an existing one)
    // unique (context,error) keys in the output
    const keys = built.dataset.cases.map((c) => dedupKey(c.context, c.error));
    assert.equal(new Set(keys).size, keys.length);
});

// ---------------------------------------------------------------------------
// COV-1..3 — coverage + immutability
// ---------------------------------------------------------------------------

test('COV-1: build fails when total cases < EVAL_MIN_CASES', () => {
    assert.throws(
        () => assembleDataset(
            loadFixtureInputs(),
            { rootDir: REPO_ROOT, datasetId: 'x', skill: 'install-dsh', builtAt: BUILT_AT, thresholds: { minCases: 999, minCasesPerScenario: 3, minRealLogCases: 1 } },
        ),
        (e: BuildError) => e.stage === 'coverage' && e.details.some((d) => d.includes('EVAL_MIN_CASES')),
    );
});

test('COV-1: build fails when a manifest class has fewer than EVAL_MIN_CASES_PER_SCENARIO cases', () => {
    assert.throws(
        () => assembleDataset(
            loadFixtureInputs(),
            { rootDir: REPO_ROOT, datasetId: 'x', skill: 'install-dsh', builtAt: BUILT_AT, thresholds: { minCases: 20, minCasesPerScenario: 100, minRealLogCases: 1 } },
        ),
        (e: BuildError) => e.stage === 'coverage' && e.details.some((d) => d.includes('EVAL_MIN_CASES_PER_SCENARIO')),
    );
});

test('COV-1: a manifest class with no cases makes the dataset invalid', () => {
    const inputs = loadFixtureInputs();
    const curations = inputs.caseCurations.filter((c) => c.scenario !== 'efs');
    const logs = inputs.errorLogCases.filter((l) => l.scenario !== 'efs');
    assert.throws(
        () => assembleDataset(
            { manifest: inputs.manifest, results: inputs.results, caseCurations: curations, errorLogCases: logs },
            { rootDir: REPO_ROOT, datasetId: 'x', skill: 'install-dsh', builtAt: BUILT_AT },
        ),
        (e: BuildError) => e.stage === 'coverage' && e.details.some((d) => d.includes('no cases')),
    );
});

test('COV-1: real-log coverage requires EVAL_MIN_REAL_LOG_CASES per class when logs exist', () => {
    // happy-path has exactly 2 curated real-log cases in the fixtures; a
    // threshold of 3 must fail the build for that class.
    assert.throws(
        () => assembleDataset(
            loadFixtureInputs(),
            { rootDir: REPO_ROOT, datasetId: 'x', skill: 'install-dsh', builtAt: BUILT_AT, thresholds: { minCases: 20, minCasesPerScenario: 3, minRealLogCases: 3 } },
        ),
        (e: BuildError) => e.stage === 'coverage' && e.details.some((d) => d.includes('real-log')),
    );
    // A class with no curated logs is exempt (0 required) and recorded in the report.
    const inputs = loadFixtureInputs();
    const logs = inputs.errorLogCases.filter((l) => l.scenario !== 'happy-path');
    const built = assembleDataset(
        { manifest: inputs.manifest, results: inputs.results, caseCurations: inputs.caseCurations, errorLogCases: logs },
        { rootDir: REPO_ROOT, datasetId: 'x', skill: 'install-dsh', builtAt: BUILT_AT },
    );
    assert.equal(built.report.coverage.logs_available_by_scenario['happy-path'], false);
    assert.equal(built.report.coverage.pass, true);
});

test('COV-2: build report records per-class, per-source, dedup and sha256', () => {
    const built = buildFixture();
    const r = built.report;
    assert.equal(r.counts.total, 24);
    assert.deepEqual(r.counts.by_scenario, { 'happy-path': 7, efs: 6, junction: 6, 'service-password': 5 });
    assert.deepEqual(r.counts.by_source, { sandbox_test: 16, error_log: 8 });
    assert.equal(r.dedup.input_cases, 25);
    assert.equal(r.dedup.duplicates_removed, 1);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.coverage.pass, true);
    assert.equal(r.coverage.verified_pct, 100);
});

test('COV-3: dataset is deterministic with a pinned built_at (same inputs ⇒ same sha256)', () => {
    const a = buildFixture();
    const b = buildFixture();
    const ja = serializeDataset(a.dataset);
    const jb = serializeDataset(b.dataset);
    assert.equal(ja, jb);
    assert.equal(computeSha256(ja), computeSha256(jb));
    assert.equal(a.dataset.case_count, 24);
});

// ---------------------------------------------------------------------------
// QL-1..3 / SEC-GEPA-08 — no secrets
// ---------------------------------------------------------------------------

test('QL-1: a surviving secret-shaped string fails the build at the secret-scan stage', () => {
    const inputs = loadFixtureInputs();
    const leaky: ErrorLogCase = {
        ...inputs.errorLogCases[0],
        context: 'the provider key OPENAI_API_KEY was configured on the laptop',
    };
    assert.throws(
        () =>
            assembleDataset(
                { manifest: inputs.manifest, results: inputs.results, caseCurations: inputs.caseCurations, errorLogCases: [...inputs.errorLogCases, leaky] },
                { rootDir: REPO_ROOT, datasetId: 'x', skill: 'install-dsh', builtAt: BUILT_AT },
            ),
        (e: BuildError) => e.stage === 'secret-scan' && /QL-1/.test(e.message),
    );
});

test('SEC-GEPA-08: redaction masks key-shaped strings before the dataset is written', () => {
    const record = sampleRecord({ context: 'key=sk-abcDEF1234567890xyz used at install time' });
    const redacted = redactRecord(record);
    assert.ok(!redacted.context.includes('sk-abcDEF1234567890xyz'));
    assert.ok(redacted.context.includes('(redacted)'));
    // The redacted dataset scans clean.
    const hits = scanJsonValue(redacted);
    assert.equal(hits.length, 0);
});

test('QL-1: secret-scan guard detects provider env refs, sk-keys, google keys, bot tokens, assignments', () => {
    assert.ok(scanSecrets('DEEPSEEK_API_KEY is set').some((h) => h.pattern === 'env-ref'));
    assert.ok(scanSecrets('k=sk-abcDEF1234567890xyz').some((h) => h.pattern === 'sk-key'));
    assert.ok(scanSecrets('AIzaSyA12345678901234567890123456789012').some((h) => h.pattern === 'google-key'));
    assert.ok(scanSecrets('123456789:AAH4x8cLmNoPqRsTuVwXyZ0123456789abcdefg').some((h) => h.pattern === 'telegram-token'));
    assert.ok(scanSecrets('API_KEY=supersecretvalue123').some((h) => h.pattern === 'assignment'));
    assert.ok(scanSecrets('-----BEGIN RSA PRIVATE KEY-----').some((h) => h.pattern === 'pem-key'));
    assert.equal(scanSecrets('no secrets in this text at all').length, 0);
});

test('QL-3: assertDatasetOutputPath rejects outputs outside datasets/reports dirs', () => {
    const evo = join(REPO_ROOT, 'agent-desktop/evolution');
    assert.throws(() => assertDatasetOutputPath(evo, '/tmp/out.json', 'datasets'), /QL-3/);
    assert.doesNotThrow(() => assertDatasetOutputPath(evo, join(evo, 'datasets/x.json'), 'datasets'));
    assert.doesNotThrow(() => assertDatasetOutputPath(evo, join(evo, 'reports/x.json'), 'reports'));
    assert.throws(() => assertDatasetOutputPath(evo, join(evo, 'fixtures/x.json'), 'datasets'), /QL-3/);
});

// ---------------------------------------------------------------------------
// Full fixture build
// ---------------------------------------------------------------------------

test('fixture build: dataset v0.1 meets §4.3 coverage and §4.2 schema', () => {
    const built = buildFixture();
    const d = built.dataset;
    assert.equal(d.case_count, 24);
    assert.equal(d.schema_version, 1);
    assert.equal(d.skill, 'install-dsh');
    assert.equal(d.harness_version, '0.1.0');
    for (const c of d.cases) {
        assert.ok(c.context.length > 0 && c.error.length > 0 && c.fix.length > 0);
        assert.ok(c.fix.trim().toLowerCase() !== 'retry');
        assert.ok(['sandbox-pass', 'human-confirmed'].includes(c.verified));
        assert.ok(['critical', 'major', 'minor'].includes(c.severity));
        assert.ok(c.source.type === 'sandbox_test' || c.source.type === 'error_log');
        assert.ok(c.source.ref.length > 0 && c.source.harness_version.length > 0);
        assert.match(c.id, /^EVAL-install-dsh-\d{3}$/);
    }
    const perClass = built.report.counts.by_scenario;
    for (const cls of Object.keys(loadFixtureInputs().manifest.scenario_classes)) {
        assert.ok((perClass[cls] ?? 0) >= 3, `${cls} must have >= 3 cases`);
    }
    assert.equal(built.report.coverage.verified_pct, 100);
    assert.equal(built.report.secret_scan.pass, true);
});

// ---------------------------------------------------------------------------
// CLI contract (spawned, integration)
// ---------------------------------------------------------------------------

const CLI = join(EVO, 'src/build-eval-dataset.ts');
const SCAN_CLI = join(EVO, 'src/secret-scan.ts');

function cliArgs(out: string, report: string): string[] {
    return [
        '--import', 'tsx', CLI,
        '--root', REPO_ROOT,
        '--manifest', join(EVO, 'fixtures/sandbox/manifest.json'),
        '--results', join(EVO, 'fixtures/sandbox/results/mode-a.json'),
        '--case-curation', join(EVO, 'fixtures/sandbox/case-curation.jsonl'),
        '--error-log-cases', join(EVO, 'fixtures/logs/error-log-cases.jsonl'),
        '--out', out,
        '--report', report,
        '--timestamp', BUILT_AT,
        '--allow-any-path',
    ];
}

test('CLI: builds a dataset, writes 0600 files, and refuses to overwrite (COV-3)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-dataset-cli-'));
    try {
        const out = join(dir, 'dataset.json');
        const report = join(dir, 'report.json');
        const first = await execFileP(process.execPath, cliArgs(out, report), { cwd: AGENT_DESKTOP });
        assert.ok(first.stdout.includes('eval-dataset build OK'));
        const dataset = loadJson(join(dir, 'dataset.json'), 'dataset');
        assert.equal(dataset.case_count, 24);
        const mode = (await import('node:fs')).statSync(out).mode & 0o777;
        assert.equal(mode, 0o600, 'dataset local copy must be 0600 (QL-3)');
        // COV-3: second build without --force must fail.
        await assert.rejects(
            execFileP(process.execPath, cliArgs(out, report), { cwd: AGENT_DESKTOP }),
            (e: { code?: number; stderr?: string }) => e.code === 1 && /immutable/.test(e.stderr ?? ''),
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('CLI: secret-scan exits 1 on a key-shaped string, 0 on a clean file (SEC-LOG-02)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-scan-cli-'));
    try {
        const dirty = join(dir, 'dirty.txt');
        const clean = join(dir, 'clean.txt');
        writeFileSync(dirty, 'DEEPSEEK_API_KEY=sk-abcDEF1234567890xyz\n');
        writeFileSync(clean, 'install-dsh: no secrets here\n');
        await assert.rejects(
            execFileP(process.execPath, ['--import', 'tsx', SCAN_CLI, dirty], { cwd: AGENT_DESKTOP }),
            (e: { code?: number }) => e.code === 1,
        );
        const ok = await execFileP(process.execPath, ['--import', 'tsx', SCAN_CLI, clean], { cwd: AGENT_DESKTOP });
        assert.ok(ok.stderr.includes('PASS'));
        assert.ok(existsSync(clean));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
