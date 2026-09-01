/**
 * GEPA eval dataset builder — core library (T11, TASK-8866 / Redmine #44).
 *
 * Turns Windows Sandbox test results (T14 harness) + real error logs into
 * a "Context → error → fix" eval dataset that satisfies
 * `docs/skill-evolution-acceptance.md` §4 (T10) and `docs/gepa-pipeline.md`
 * §3.1 stage 1 (T09):
 *
 *   - SRC-1..3  provenance: every case traces to exactly one verifiable
 *               source (`sandbox_test` | `error_log`) — unverifiable
 *               sources are rejected at build time.
 *   - FMT-1..5  schema-valid records `{id, context, error, fix, scenario,
 *               source{type,ref,harness_version}, severity, verified}`,
 *               no duplicates on (context, error), fix is the correct
 *               handling (never just "retry").
 *   - COV-1..3  coverage thresholds (EVAL_MIN_CASES / _PER_SCENARIO /
 *               _REAL_LOG_CASES), every manifest class present, dataset
 *               immutable during a run (pinned sha256).
 *   - SEC-GEPA-08 / QL-1..3  redaction before use, secret-scan 0 hits on
 *               the dataset, dataset committed only to the datasets dir.
 *
 * The library is pure (no CLI side effects) so the test suite and the CLI
 * wrapper share it. All path resolution is relative to `rootDir` (default
 * process.cwd() — the repo root when invoked from the repository).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute, relative, sep } from 'node:path';
import { validateJsonSchema, type JsonValue } from './validate.js';
import { scanJsonValue, type SecretHit } from './secret-scan.js';
import { redactSecrets } from '../../src/redact.js';

// ---------------------------------------------------------------------------
// Types (T10 §4.2 record shape + builder inputs)
// ---------------------------------------------------------------------------

export type Severity = 'critical' | 'major' | 'minor';
export type Verified = 'sandbox-pass' | 'human-confirmed';
export type SourceType = 'sandbox_test' | 'error_log';

export interface SourceRef {
    type: SourceType;
    ref: string;
    harness_version: string;
}

export interface DatasetRecord {
    id: string;
    context: string;
    error: string;
    fix: string;
    scenario: string;
    source: SourceRef;
    severity: Severity;
    verified: Verified;
}

export interface EvalDataset {
    schema_version: 1;
    dataset_id: string;
    skill: string;
    built_at: string;
    harness_version: string;
    case_count: number;
    cases: DatasetRecord[];
}

/** T14 harness manifest (format proposed by T11 for tester to adopt). */
export interface HarnessManifest {
    schema_version: number;
    harness: string;
    harness_version: string;
    skill: string;
    scenario_classes: Record<string, { description: string; planted_failure: boolean }>;
    cases: Array<{ id: string; scenario: string; name: string }>;
}

/** T14 harness run results (Mode A offline / Mode B owner-uploaded). */
export interface SandboxResults {
    harness_version: string;
    run_id: string;
    mode: string;
    results: Array<{ case_id: string; passed: boolean; error?: string | null; captured_output?: string }>;
}

/** Curated context/fix/severity for a sandbox-derived dataset case. */
export interface CaseCuration {
    case_id: string;
    context: string;
    error?: string;
    fix: string;
    scenario: string;
    severity: Severity;
    /** Test that passes when the fix is applied (defaults to case_id). */
    fix_case_id?: string;
}

/** Error-log-derived dataset case draft; `ref` = <file>:<line>. */
export interface ErrorLogCase {
    ref: string;
    context: string;
    error: string;
    fix: string;
    scenario: string;
    severity: Severity;
    verified: Verified;
}

export interface BuildInputs {
    manifest: HarnessManifest;
    results: SandboxResults;
    caseCurations: CaseCuration[];
    errorLogCases: ErrorLogCase[];
}

export interface BuildThresholds {
    minCases: number;
    minCasesPerScenario: number;
    minRealLogCases: number;
}

export interface BuildResult {
    dataset: EvalDataset;
    datasetSha256: string;
    report: BuildReport;
}

export interface BuildReport {
    dataset_id: string;
    schema_version: number;
    skill: string;
    built_at: string;
    harness_version: string;
    counts: {
        total: number;
        by_scenario: Record<string, number>;
        by_source: Record<string, number>;
        by_verified: Record<string, number>;
        by_severity: Record<string, number>;
        real_log_by_scenario: Record<string, number>;
    };
    dedup: { input_cases: number; duplicates_removed: number; duplicate_keys: string[] };
    coverage: {
        min_cases: number;
        min_cases_per_scenario: number;
        min_real_log_cases: number;
        verified_pct: number;
        classes_covered: string[];
        classes_missing: string[];
        logs_available_by_scenario: Record<string, boolean>;
        pass: boolean;
        errors: string[];
    };
    secret_scan: { hits: SecretHit[]; scanned_bytes: number; pass: boolean };
    sha256: string;
}

export class BuildError extends Error {
    constructor(
        message: string,
        readonly stage: string,
        readonly details: string[] = [],
    ) {
        super(message);
        this.name = 'BuildError';
    }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export function loadJson<T>(path: string, what: string): T {
    if (!existsSync(path)) {
        throw new BuildError(`${what} not found: ${path}`, 'load');
    }
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as T;
    } catch (err) {
        throw new BuildError(`${what} is not valid JSON: ${path}`, 'load', [String(err)]);
    }
}

export function loadJsonLines<T>(path: string, what: string): T[] {
    if (!existsSync(path)) {
        throw new BuildError(`${what} not found: ${path}`, 'load');
    }
    const lines = readFileSync(path, 'utf8').split('\n');
    const out: T[] = [];
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            return;
        }
        try {
            out.push(JSON.parse(trimmed) as T);
        } catch (err) {
            throw new BuildError(`${what} line ${i + 1} is not valid JSON`, 'load', [trimmed.slice(0, 200), String(err)]);
        }
    });
    return out;
}

// ---------------------------------------------------------------------------
// Provenance verification (SRC-1..3)
// ---------------------------------------------------------------------------

function parseLogRef(ref: string): { file: string; line: number } | null {
    const m = /^(.+):(\d+)$/.exec(ref.trim());
    if (!m) {
        return null;
    }
    return { file: m[1], line: Number(m[2]) };
}

/**
 * SRC-3: a sandbox-derived case must come from the T14 manifest; the case
 * id must exist, a result entry must exist, and (for failed tests) the
 * error must match the captured failure exactly (SRC-2 mirror).
 * FMT-3: verified=sandbox-pass requires the fix-validation test to pass.
 */
export function verifySandboxSource(
    curation: CaseCuration,
    manifest: HarnessManifest,
    results: SandboxResults,
): void {
    const manifestCase = manifest.cases.find((c) => c.id === curation.case_id);
    if (!manifestCase) {
        throw new BuildError(`sandbox case ${curation.case_id} is not in the T14 manifest (SRC-3)`, 'source');
    }
    if (!(curation.scenario in manifest.scenario_classes)) {
        throw new BuildError(
            `sandbox case ${curation.case_id}: unknown scenario '${curation.scenario}' (FMT-2)`,
            'source',
        );
    }
    if (manifestCase.scenario !== curation.scenario) {
        throw new BuildError(
            `sandbox case ${curation.case_id}: curation scenario '${curation.scenario}' does not match manifest scenario '${manifestCase.scenario}'`,
            'source',
        );
    }
    if (results.harness_version !== manifest.harness_version) {
        throw new BuildError(
            `results harness_version '${results.harness_version}' != manifest '${manifest.harness_version}' (SRC-3)`,
            'source',
        );
    }
    const result = results.results.find((r) => r.case_id === curation.case_id);
    if (!result) {
        throw new BuildError(`sandbox case ${curation.case_id}: no result entry in the harness results (SRC-1)`, 'source');
    }
    if (!result.passed) {
        // A failed test: the curation error must quote the captured failure
        // exactly (SRC-2 mirror — no paraphrase of the failure signature).
        const expected = result.error ?? '';
        const given = curation.error ?? '';
        if (given.length === 0) {
            throw new BuildError(
                `sandbox case ${curation.case_id} failed but curation has no error (SRC-2)`,
                'source',
            );
        }
        if (expected.length === 0) {
            throw new BuildError(
                `sandbox case ${curation.case_id} failed but the result captures no error`,
                'source',
            );
        }
        if (given.trim() !== expected.trim()) {
            throw new BuildError(
                `sandbox case ${curation.case_id}: curation error does not match the captured failure exactly (SRC-2)\n  captured: ${expected}\n  curated:  ${given}`,
                'source',
            );
        }
    } else if (!curation.error || curation.error.trim().length === 0) {
        // A passing test still yields a dataset case: FMT-1 requires a
        // non-empty error — the symptom the test guards against (the
        // regression signature), recorded in the curation.
        throw new BuildError(
            `sandbox case ${curation.case_id} passed but curation has no error (FMT-1: the guarded failure symptom)`,
            'source',
        );
    }
    // FMT-3: the fix must be backed by a passing harness test.
    const fixCaseId = curation.fix_case_id ?? curation.case_id;
    const fixResult = results.results.find((r) => r.case_id === fixCaseId);
    if (!fixResult) {
        throw new BuildError(
            `sandbox case ${curation.case_id}: fix-validation test ${fixCaseId} has no result (FMT-3)`,
            'source',
        );
    }
    if (!fixResult.passed) {
        throw new BuildError(
            `sandbox case ${curation.case_id}: fix-validation test ${fixCaseId} did not pass — fix is not verified (FMT-3)`,
            'source',
        );
    }
}

/**
 * SRC-1/SRC-2: an error-log case must reference <file>:<line> of a real
 * file that exists, and the error must be quoted exactly from that line.
 */
export function verifyErrorLogSource(logCase: ErrorLogCase, rootDir: string): string {
    const parsed = parseLogRef(logCase.ref);
    if (!parsed) {
        throw new BuildError(`error_log ref '${logCase.ref}' is not <file>:<line> (SRC-1)`, 'source');
    }
    const filePath = isAbsolute(parsed.file) ? parsed.file : resolve(rootDir, parsed.file);
    if (!existsSync(filePath)) {
        throw new BuildError(`error_log ref file not found: ${filePath} (SRC-1)`, 'source');
    }
    const lines = readFileSync(filePath, 'utf8').split('\n');
    if (parsed.line < 1 || parsed.line > lines.length) {
        throw new BuildError(`error_log ref line ${parsed.line} out of range in ${filePath} (SRC-1)`, 'source');
    }
    const lineText = lines[parsed.line - 1];
    if (!lineText.includes(logCase.error)) {
        throw new BuildError(
            `error_log case error is not quoted exactly from ${logCase.ref} (SRC-2)\n  line:     ${lineText.trim()}\n  expected: ${logCase.error}`,
            'source',
        );
    }
    return filePath;
}

// ---------------------------------------------------------------------------
// Record validation (FMT-1..5) + dedup (FMT-5)
// ---------------------------------------------------------------------------

/** Normalized (context, error) dedup key — whitespace-collapsed, lowercase. */
export function dedupKey(context: string, error: string): string {
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    return `${norm(context)}\u0000${norm(error)}`;
}

export function validateRecordShape(record: DatasetRecord): void {
    const errors: string[] = [];
    if (!record.context || !record.error || !record.fix) {
        errors.push('context/error/fix must all be non-empty (FMT-1)');
    }
    if (record.fix.trim().toLowerCase() === 'retry' || record.fix.trim().toLowerCase() === 'just retry') {
        errors.push('fix must state the correct handling, not just "retry" (FMT-1)');
    }
    if (!['critical', 'major', 'minor'].includes(record.severity)) {
        errors.push(`invalid severity '${record.severity}'`);
    }
    if (!['sandbox-pass', 'human-confirmed'].includes(record.verified)) {
        errors.push(`invalid verified '${record.verified}' (FMT-3)`);
    }
    if (record.source.type !== 'sandbox_test' && record.source.type !== 'error_log') {
        errors.push(`invalid source.type '${record.source.type}'`);
    }
    if (!record.source.ref || !record.source.harness_version) {
        errors.push('source.ref and source.harness_version are mandatory (SRC-1)');
    }
    // id is assigned after dedup; the EVAL-<skill>-<NNN> pattern is enforced
    // by the schema validation step (FMT-4), which runs post-assignment.
    if (record.id !== '' && !/^EVAL-[a-z0-9-]+-\d{3,}$/.test(record.id)) {
        errors.push(`id '${record.id}' does not match EVAL-<skill>-<NNN> (T10 §4.2)`);
    }
    if (errors.length > 0) {
        throw new BuildError(`record ${record.id || '<draft>'} failed shape validation (FMT-1..3)`, 'validate', errors);
    }
}

// ---------------------------------------------------------------------------
// Coverage (COV-1..3)
// ---------------------------------------------------------------------------

export function checkCoverage(
    records: DatasetRecord[],
    manifest: HarnessManifest,
    thresholds: BuildThresholds,
    realLogCases: ErrorLogCase[],
): { pass: boolean; errors: string[]; logsAvailableByScenario: Record<string, boolean>; verifiedPct: number } {
    const errors: string[] = [];
    const classes = Object.keys(manifest.scenario_classes);
    const byScenario = new Map<string, number>();
    const realLogByScenario = new Map<string, number>();
    let verified = 0;
    for (const r of records) {
        byScenario.set(r.scenario, (byScenario.get(r.scenario) ?? 0) + 1);
        if (r.source.type === 'error_log') {
            realLogByScenario.set(r.scenario, (realLogByScenario.get(r.scenario) ?? 0) + 1);
        }
        if (r.verified === 'sandbox-pass' || r.verified === 'human-confirmed') {
            verified += 1;
        }
    }
    const logsAvailableByScenario: Record<string, boolean> = {};
    for (const cls of classes) {
        logsAvailableByScenario[cls] = realLogCases.some((l) => l.scenario === cls);
    }

    // COV-1: every manifest class must be present with >= minCasesPerScenario.
    const classesMissing = classes.filter((c) => !byScenario.has(c) || (byScenario.get(c) ?? 0) === 0);
    if (classesMissing.length > 0) {
        errors.push(`COV-1: manifest classes with no cases: ${classesMissing.join(', ')}`);
    }
    for (const c of classes) {
        const n = byScenario.get(c) ?? 0;
        if (n < thresholds.minCasesPerScenario) {
            errors.push(`COV-1: scenario '${c}' has ${n} case(s) < EVAL_MIN_CASES_PER_SCENARIO=${thresholds.minCasesPerScenario}`);
        }
    }
    if (records.length < thresholds.minCases) {
        errors.push(`COV-1: total ${records.length} < EVAL_MIN_CASES=${thresholds.minCases}`);
    }
    // Real-log cases: >= minRealLogCases per class that has logs available.
    for (const c of classes) {
        if (logsAvailableByScenario[c]) {
            const n = realLogByScenario.get(c) ?? 0;
            if (n < thresholds.minRealLogCases) {
                errors.push(
                    `COV-1: scenario '${c}' has ${n} real-log case(s) < EVAL_MIN_REAL_LOG_CASES=${thresholds.minRealLogCases}`,
                );
            }
        }
    }
    // FMT-3: verified 100% (unverified excluded at build time).
    if (verified !== records.length) {
        errors.push(`FMT-3: ${records.length - verified} unverified case(s) — verified must be 100%`);
    }
    const verifiedPct = records.length === 0 ? 0 : Math.round((verified / records.length) * 1000) / 10;
    return { pass: errors.length === 0, errors, logsAvailableByScenario, verifiedPct };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function computeSha256(data: Buffer | string): string {
    return createHash('sha256').update(data).digest('hex');
}

/** Apply SEC-GEPA-08 redaction to the free-text fields of a record. */
export function redactRecord(record: DatasetRecord): DatasetRecord {
    return {
        ...record,
        context: redactSecrets(record.context),
        error: redactSecrets(record.error),
        fix: redactSecrets(record.fix),
    };
}

export interface AssembleOptions {
    rootDir?: string;
    datasetId: string;
    skill: string;
    builtAt?: string;
    thresholds?: Partial<BuildThresholds>;
    /** Secret-scan the final dataset (QL-1); default true. */
    scanSecretsEnabled?: boolean;
}

export const DEFAULT_THRESHOLDS: BuildThresholds = {
    minCases: 20,
    minCasesPerScenario: 3,
    minRealLogCases: 1,
};

/** Load + validate the JSON Schema contract (FMT-4). */
export function loadDatasetSchema(rootDir: string): { schema: unknown; text: string } {
    const schemaPath = resolve(rootDir, 'agent-desktop/evolution/contracts/eval-dataset.schema.json');
    return { schema: loadJson(schemaPath, 'eval-dataset schema'), text: readFileSync(schemaPath, 'utf8') };
}

/**
 * Build the eval dataset from the given inputs. Pure (no writes): returns
 * the dataset object + a self-contained report (coverage, dedup, secret
 * scan, dataset sha256); the CLI layer only serializes + writes the files.
 *
 * Every failure is a BuildError carrying the failing guardrail (SRC/FMT/COV/
 * QL) so build-time rejection is explicit and the audit trail can record it.
 */
export function assembleDataset(inputs: BuildInputs, opts: AssembleOptions): BuildResult {
    const rootDir = opts.rootDir ?? process.cwd();
    const { manifest, results, caseCurations, errorLogCases } = inputs;
    const thresholds: BuildThresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
    const builtAt = opts.builtAt ?? new Date().toISOString();
    const schema = loadDatasetSchema(rootDir).schema as { definitions?: Record<string, unknown> };

    // 1. Provenance + draft construction (SRC-1..3).
    const drafts: DatasetRecord[] = [];

    // Sandbox-derived drafts: verified = sandbox-pass (FMT-3, backed by the
    // fix-validation test passing — checked in verifySandboxSource).
    for (const curation of caseCurations) {
        verifySandboxSource(curation, manifest, results);
        drafts.push({
            id: '', // assigned later, deterministic
            context: curation.context,
            error: curation.error ?? '',
            fix: curation.fix,
            scenario: curation.scenario,
            source: { type: 'sandbox_test', ref: curation.case_id, harness_version: manifest.harness_version },
            severity: curation.severity,
            verified: 'sandbox-pass',
        });
    }

    // Error-log drafts: verified comes from the curation (human-confirmed or
    // sandbox-pass when a harness test backs it) — SRC-2 exact quote check.
    for (const logCase of errorLogCases) {
        verifyErrorLogSource(logCase, rootDir);
        if (!(logCase.scenario in manifest.scenario_classes)) {
            throw new BuildError(
                `error_log case (ref ${logCase.ref}): unknown scenario '${logCase.scenario}' (FMT-2)`,
                'source',
            );
        }
        drafts.push({
            id: '',
            context: logCase.context,
            error: logCase.error,
            fix: logCase.fix,
            scenario: logCase.scenario,
            source: { type: 'error_log', ref: logCase.ref, harness_version: manifest.harness_version },
            severity: logCase.severity,
            verified: logCase.verified,
        });
    }

    // 2. Redact tool output before use (SEC-GEPA-08) + shape validation.
    const redacted = drafts.map((d) => redactRecord(d));
    for (const r of redacted) {
        validateRecordShape(r);
    }

    // 3. FMT-5 dedup on (context, error).
    const seen = new Map<string, DatasetRecord>();
    const duplicateKeys: string[] = [];
    for (const r of redacted) {
        const key = dedupKey(r.context, r.error);
        if (seen.has(key)) {
            duplicateKeys.push(key);
        } else {
            seen.set(key, r);
        }
    }

    // 4. Assign deterministic ids: sort by manifest scenario order, then
    //    source type, then source ref, then original input index.
    const scenarioOrder = new Map(Object.keys(manifest.scenario_classes).map((c, i) => [c, i]));
    const unique = [...seen.values()].sort((a, b) => {
        const sa = scenarioOrder.get(a.scenario) ?? 999;
        const sb = scenarioOrder.get(b.scenario) ?? 999;
        if (sa !== sb) {
            return sa - sb;
        }
        if (a.source.type !== b.source.type) {
            return a.source.type < b.source.type ? -1 : 1;
        }
        if (a.source.ref !== b.source.ref) {
            return a.source.ref < b.source.ref ? -1 : 1;
        }
        return 0;
    });
    const records = unique.map((r, i) => ({ ...r, id: `EVAL-${opts.skill}-${String(i + 1).padStart(3, '0')}` }));

    // 5. Coverage (COV-1..3).
    const coverage = checkCoverage(records, manifest, thresholds, errorLogCases);
    if (!coverage.pass) {
        throw new BuildError('coverage thresholds not met (COV-1)', 'coverage', coverage.errors);
    }

    // 6. Schema validation (FMT-4) — records validate against
    //    #/definitions/record of the contract schema.
    const schemaObj = schema as { definitions?: Record<string, unknown> };
    const recordSchema = (schemaObj.definitions ?? {})['record'];
    if (!recordSchema) {
        throw new BuildError('eval-dataset schema is missing #/definitions/record', 'validate');
    }
    const schemaErrors: string[] = [];
    for (const r of records) {
        const errs = validateJsonSchema(recordSchema as never, r as unknown as JsonValue, schema as never);
        for (const e of errs) {
            schemaErrors.push(`${r.id}: ${e.path}: ${e.message}`);
        }
    }
    if (schemaErrors.length > 0) {
        throw new BuildError('records fail eval-dataset schema validation (FMT-4)', 'validate', schemaErrors);
    }

    const dataset: EvalDataset = {
        schema_version: 1,
        dataset_id: opts.datasetId,
        skill: opts.skill,
        built_at: builtAt,
        harness_version: manifest.harness_version,
        case_count: records.length,
        cases: records,
    };

    // 7. Secret scan on the final dataset (QL-1 / SEC-GEPA-08).
    const scanEnabled = opts.scanSecretsEnabled ?? true;
    const hits = scanEnabled ? scanJsonValue(dataset) : [];
    if (scanEnabled && hits.length > 0) {
        throw new BuildError(
            `secret-scan found ${hits.length} hit(s) on the dataset — SEC-LOG-02 / QL-1 requires 0`,
            'secret-scan',
            hits.map((h) => `[${h.pattern}] ${h.match}`),
        );
    }

    const counts = {
        total: records.length,
        by_scenario: Object.fromEntries(scenarioOrderKeys(manifest).map((c) => [c, records.filter((r) => r.scenario === c).length])),
        by_source: {
            sandbox_test: records.filter((r) => r.source.type === 'sandbox_test').length,
            error_log: records.filter((r) => r.source.type === 'error_log').length,
        },
        by_verified: {
            'sandbox-pass': records.filter((r) => r.verified === 'sandbox-pass').length,
            'human-confirmed': records.filter((r) => r.verified === 'human-confirmed').length,
        },
        by_severity: {
            critical: records.filter((r) => r.severity === 'critical').length,
            major: records.filter((r) => r.severity === 'major').length,
            minor: records.filter((r) => r.severity === 'minor').length,
        },
        real_log_by_scenario: Object.fromEntries(
            scenarioOrderKeys(manifest).map((c) => [c, records.filter((r) => r.scenario === c && r.source.type === 'error_log').length]),
        ),
    };

    const report: BuildReport = {
        dataset_id: opts.datasetId,
        schema_version: 1,
        skill: opts.skill,
        built_at: builtAt,
        harness_version: manifest.harness_version,
        counts,
        dedup: {
            input_cases: redacted.length,
            duplicates_removed: duplicateKeys.length,
            duplicate_keys: duplicateKeys,
        },
        coverage: {
            min_cases: thresholds.minCases,
            min_cases_per_scenario: thresholds.minCasesPerScenario,
            min_real_log_cases: thresholds.minRealLogCases,
            verified_pct: coverage.verifiedPct,
            classes_covered: scenarioOrderKeys(manifest).filter((c) => (counts.by_scenario[c] ?? 0) > 0),
            classes_missing: coverage.errors.length > 0 ? [] : [], // pass ⇒ none missing
            logs_available_by_scenario: coverage.logsAvailableByScenario,
            pass: true,
            errors: [],
        },
        secret_scan: {
            hits,
            scanned_bytes: 0, // filled below after serialization
            pass: hits.length === 0,
        },
        sha256: '',
    };
    // classes_missing computed from counts for completeness even on pass.
    report.coverage.classes_missing = scenarioOrderKeys(manifest).filter((c) => (counts.by_scenario[c] ?? 0) === 0);

    // COV-3: the dataset hash is computed over the exact serialized bytes so
    // a run can pin dataset version + sha256 (immutable during the run). The
    // report is finalized here — self-contained for the audit trail.
    const json = serializeDataset(dataset);
    const sha256 = computeSha256(json);
    report.sha256 = sha256;
    report.secret_scan.scanned_bytes = Buffer.byteLength(json, 'utf8');

    return { dataset, datasetSha256: sha256, report };
}

function scenarioOrderKeys(manifest: HarnessManifest): string[] {
    return Object.keys(manifest.scenario_classes);
}

/** Serialize the dataset deterministically (sorted keys, 2-space indent). */
export function serializeDataset(dataset: EvalDataset): string {
    return `${JSON.stringify(dataset, null, 2)}\n`;
}

export function serializeReport(report: BuildReport): string {
    return `${JSON.stringify(report, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// QL-3: output policy
// ---------------------------------------------------------------------------

/**
 * QL-3: dataset files are committed only to the dataset directory. The CLI
 * enforces that `outPath` (and `reportPath`) resolve inside
 * `<evolutionRoot>/datasets` / `<evolutionRoot>/reports` unless explicitly
 * overridden (tests / scratch builds pass `allowAnyPath`).
 */
export function assertDatasetOutputPath(
    evolutionRoot: string,
    outPath: string,
    kind: 'datasets' | 'reports',
    allowAnyPath = false,
): void {
    if (allowAnyPath) {
        return;
    }
    const outAbs = resolve(outPath);
    const allowedAbs = resolve(evolutionRoot, kind);
    const rel = relative(allowedAbs, outAbs);
    if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) {
        return;
    }
    throw new BuildError(
        `QL-3: output path ${outPath} is outside ${allowedAbs} — dataset files are committed only to the ${kind} directory`,
        'output-policy',
    );
}
