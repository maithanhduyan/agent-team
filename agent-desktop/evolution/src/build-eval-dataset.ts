/**
 * GEPA eval dataset builder — CLI (T11, TASK-8866 / Redmine #44).
 *
 * Converts T14 Windows Sandbox test results + real error logs into a
 * "Context → error → fix" eval dataset per T10 §4 / T09 §3.1 stage 1:
 *
 *   node --import tsx agent-desktop/evolution/src/build-eval-dataset.ts \
 *     --manifest agent-desktop/evolution/fixtures/sandbox/manifest.json \
 *     --results  agent-desktop/evolution/fixtures/sandbox/results/mode-a.json \
 *     --case-curation agent-desktop/evolution/fixtures/sandbox/case-curation.jsonl \
 *     --error-log-cases agent-desktop/evolution/fixtures/logs/error-log-cases.jsonl \
 *     --out agent-desktop/evolution/datasets/install-dsh-v0.1.json \
 *     --report agent-desktop/evolution/reports/install-dsh-v0.1.report.json
 *
 * Env (T10 §8): EVAL_MIN_CASES (20), EVAL_MIN_CASES_PER_SCENARIO (3),
 * EVAL_MIN_REAL_LOG_CASES (1), EVAL_DATASET_SCHEMA_VERSION (1).
 *
 * Guarantees enforced:
 *   - SRC-1..3  every case traces to a verifiable source; unverifiable
 *               sources fail the build (exit 1, reasons listed).
 *   - FMT-1..5  schema-valid records (contracts/eval-dataset.schema.json),
 *               dedup on (context, error), fix != "retry".
 *   - COV-1..3  coverage thresholds; dataset file is immutable — the
 *               builder refuses to overwrite an existing dataset (use a new
 *               version id, or --force to rebuild deliberately).
 *   - QL-1..3   secret-scan 0 hits on the final dataset; dataset written
 *               only under evolution/datasets; local copies chmod 0600.
 */

import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    assembleDataset,
    assertDatasetOutputPath,
    BuildError,
    computeSha256,
    loadJson,
    loadJsonLines,
    serializeDataset,
    serializeReport,
    type BuildReport,
    type CaseCuration,
    type ErrorLogCase,
    type HarnessManifest,
    type SandboxResults,
} from './dataset.js';

interface CliArgs {
    manifest: string;
    results: string;
    caseCuration: string;
    errorLogCases: string;
    out: string;
    report: string;
    datasetId: string;
    skill: string;
    timestamp?: string;
    force: boolean;
    allowAnyPath: boolean;
    rootDir: string;
}

function usage(): string {
    return `usage: build-eval-dataset.ts --manifest <json> --results <json> --case-curation <jsonl> --error-log-cases <jsonl> --out <json> --report <json> [--datasetId <id>] [--skill <name>] [--timestamp <iso>] [--force] [--allow-any-path] [--root <dir>]`;
}

function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
        manifest: '',
        results: '',
        caseCuration: '',
        errorLogCases: '',
        out: '',
        report: '',
        datasetId: 'install-dsh-v0.1',
        skill: 'install-dsh',
        force: false,
        allowAnyPath: false,
        rootDir: process.cwd(),
    };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        const next = () => {
            i += 1;
            if (i >= argv.length) {
                throw new BuildError(`missing value for ${a}`, 'cli');
            }
            return argv[i];
        };
        switch (a) {
            case '--manifest':
                args.manifest = next();
                break;
            case '--results':
                args.results = next();
                break;
            case '--case-curation':
                args.caseCuration = next();
                break;
            case '--error-log-cases':
                args.errorLogCases = next();
                break;
            case '--out':
                args.out = next();
                break;
            case '--report':
                args.report = next();
                break;
            case '--datasetId':
                args.datasetId = next();
                break;
            case '--skill':
                args.skill = next();
                break;
            case '--timestamp':
                args.timestamp = next();
                break;
            case '--force':
                args.force = true;
                break;
            case '--allow-any-path':
                args.allowAnyPath = true;
                break;
            case '--root':
                args.rootDir = resolve(next());
                break;
            case '--help':
            case '-h':
                console.log(usage());
                process.exit(0);
                break;
            default:
                throw new BuildError(`unknown argument: ${a}`, 'cli', [usage()]);
        }
    }
    const missing = (['manifest', 'results', 'caseCuration', 'errorLogCases', 'out', 'report'] as const).filter(
        (k) => args[k].length === 0,
    );
    if (missing.length > 0) {
        throw new BuildError(`missing required argument(s): ${missing.join(', ')}`, 'cli', [usage()]);
    }
    return args;
}

function intEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
        return fallback;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
        throw new BuildError(`env ${name} must be a non-negative integer, got '${raw}'`, 'config');
    }
    return n;
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const rootDir = args.rootDir;

    // T10 §8 environment defaults.
    const minCases = intEnv('EVAL_MIN_CASES', 20);
    const minCasesPerScenario = intEnv('EVAL_MIN_CASES_PER_SCENARIO', 3);
    const minRealLogCases = intEnv('EVAL_MIN_REAL_LOG_CASES', 1);
    const schemaVersion = intEnv('EVAL_DATASET_SCHEMA_VERSION', 1);
    if (schemaVersion !== 1) {
        throw new BuildError(`EVAL_DATASET_SCHEMA_VERSION=${schemaVersion} unsupported — only 1 exists`, 'config');
    }

    // Load inputs.
    const manifest = loadJson<HarnessManifest>(resolve(rootDir, args.manifest), 'T14 harness manifest');
    const results = loadJson<SandboxResults>(resolve(rootDir, args.results), 'T14 sandbox results');
    const caseCurations = loadJsonLines<CaseCuration>(resolve(rootDir, args.caseCuration), 'case curation');
    const errorLogCases = loadJsonLines<ErrorLogCase>(resolve(rootDir, args.errorLogCases), 'error-log cases');

    const builtAt = args.timestamp ?? new Date().toISOString();
    const built = assembleDataset(
        { manifest, results, caseCurations, errorLogCases },
        {
            rootDir,
            datasetId: args.datasetId,
            skill: args.skill,
            builtAt,
            thresholds: { minCases, minCasesPerScenario, minRealLogCases },
        },
    );
    const dataset = built.dataset;

    // QL-3: dataset committed only to evolution/datasets (reports under reports/).
    const evolutionRoot = resolve(rootDir, 'agent-desktop/evolution');
    assertDatasetOutputPath(evolutionRoot, args.out, 'datasets', args.allowAnyPath);
    assertDatasetOutputPath(evolutionRoot, args.report, 'reports', args.allowAnyPath);

    // COV-3: dataset immutable — refuse to overwrite an existing file.
    const outAbs = resolve(rootDir, args.out);
    if (existsSync(outAbs) && !args.force) {
        throw new BuildError(
            `dataset already exists: ${outAbs} — datasets are immutable (COV-3); use a new dataset_id or --force to rebuild deliberately`,
            'immutability',
        );
    }

    const json = serializeDataset(dataset);
    const report: BuildReport = built.report; // sha256 + scanned bytes finalized by assembleDataset
    if (computeSha256(json) !== report.sha256) {
        throw new BuildError('internal: dataset hash mismatch after serialization', 'immutability');
    }

    writeFileSync(outAbs, json, { encoding: 'utf8', mode: 0o600 });
    chmodSync(outAbs, 0o600); // QL-3: local copies permission 0600.
    const reportAbs = resolve(rootDir, args.report);
    writeFileSync(reportAbs, serializeReport(report), { encoding: 'utf8', mode: 0o600 });
    chmodSync(reportAbs, 0o600);

    const c = report.counts;
    console.log(`eval-dataset build OK — dataset ${report.dataset_id} (schema v${report.schema_version})`);
    console.log(`  sha256   ${report.sha256}`);
    console.log(`  cases    ${c.total} (sandbox_test ${c.by_source.sandbox_test} / error_log ${c.by_source.error_log})`);
    console.log(`  scenarios ${Object.entries(c.by_scenario).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    console.log(`  verified ${(report.coverage.verified_pct).toFixed(1)}% · secret-scan ${report.secret_scan.hits.length} hit(s)`);
    console.log(`  dataset  ${outAbs}`);
    console.log(`  report   ${reportAbs}`);
    console.log(`  dedup    ${report.dedup.duplicates_removed} duplicate(s) removed (${report.dedup.input_cases} input cases)`);
}

try {
    main();
} catch (err) {
    if (err instanceof BuildError) {
        console.error(`eval-dataset build FAILED [${err.stage}]: ${err.message}`);
        for (const d of err.details) {
            console.error(`  - ${d}`);
        }
        process.exit(1);
    }
    console.error(`eval-dataset build FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
}
