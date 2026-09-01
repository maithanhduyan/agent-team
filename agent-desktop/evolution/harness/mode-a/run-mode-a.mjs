#!/usr/bin/env node
/**
 * Mode A runner CLI — offline (repo/CI) install-dsh eval suite.
 *
 * Runs the full manifest suite against a behavior and writes the
 * unified result JSON (schema `schema/result.schema.json`) to stdout
 * and/or a file. Exit code 0 = fitness gate 1.0 met (SEC-GEPA-02);
 * exit code 1 = gate not met or invalid invocation.
 *
 * Usage:
 *   node mode-a/run-mode-a.mjs                      # reference behavior (base skill)
 *   node mode-a/run-mode-a.mjs --behavior efs-ignore
 *   node mode-a/run-mode-a.mjs --behavior ./my-candidate.mjs
 *   node mode-a/run-mode-a.mjs --out results/mode-a.json
 *   node mode-a/run-mode-a.mjs --verify-planted     # detection matrix (CI)
 *
 * Behavior resolution: `--behavior` accepts a builtin id
 * (reference | efs-ignore | junction-naive | svc-no-restart) or a
 * path to a behavior module (default export, reference interface).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runSuite } from '../lib/runner.mjs';
import { gate } from '../lib/fitness.mjs';
import { validateManifest } from '../lib/manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const BUILTINS = {
  reference: '../impl/reference.mjs',
  'efs-ignore': '../impl/mutants/efs-ignore.mjs',
  'junction-naive': '../impl/mutants/junction-naive.mjs',
  'svc-no-restart': '../impl/mutants/svc-no-restart.mjs',
};

const PLANTED_EXPECTATIONS = {
  'efs-ignore': ['efs-detect-target', 'efs-copy-source', 'efs-cleanup-encrypted'],
  'junction-naive': ['jct-resolve', 'jct-traverse', 'jct-cleanup'],
  'svc-no-restart': ['svc-restart', 'svc-failure-safe'],
};

function parseArgs(argv) {
  const opts = { behavior: 'reference', out: null, verifyPlanted: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--behavior') opts.behavior = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--verify-planted') opts.verifyPlanted = true;
    else if (a === '--help') opts.help = true;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

async function loadBehavior(spec) {
  if (spec in BUILTINS) {
    const mod = await import(join(HERE, BUILTINS[spec]));
    return mod.default;
  }
  const abs = resolve(process.cwd(), spec);
  const mod = await import(pathToFileURL(abs).href);
  return mod.default;
}

async function verifyPlanted() {
  const matrix = [];
  for (const [id, failIds] of Object.entries(PLANTED_EXPECTATIONS)) {
    const behavior = await loadBehavior(id);
    const result = runSuite(behavior, { runId: `mode-a-planted-${id}` });
    const failedIds = result.cases.filter((c) => c.status !== 'pass').map((c) => c.id).sort();
    const detected = failIds.every((f) => failedIds.includes(f));
    matrix.push({ mutant: id, expected_failures: [...failIds].sort(), actual_failures: failedIds, detected });
  }
  const allDetected = matrix.every((m) => m.detected);
  return { planted_failures: matrix, all_detected: allDetected };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage:
  node mode-a/run-mode-a.mjs [--behavior <id|path>] [--out <file>] [--verify-planted]

Behaviors: ${Object.keys(BUILTINS).join(', ')} (default: reference)
--verify-planted  run the planted-failure detection matrix and fail if any mutant is not detected
--out <file>      also write the result JSON to <file>`);
    return;
  }

  // 1. Manifest must be valid (schema + COV-1 class coverage).
  const mv = validateManifest();
  if (!mv.valid) {
    console.error('manifest invalid:');
    for (const e of mv.errors) console.error(`  - ${e}`);
    process.exit(2);
  }

  if (opts.verifyPlanted) {
    const report = await verifyPlanted();
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.all_detected ? 0 : 1);
  }

  const behavior = await loadBehavior(opts.behavior);
  const result = runSuite(behavior, {
    candidate: { id: behavior.id, kind: 'base', path: null, size_bytes: null },
    runId: `mode-a-${behavior.id}-${Date.now()}`,
  });
  const verdict = gate(result);
  const out = JSON.stringify({ ...result, gate: verdict.gate, fitness: verdict.fitness }, null, 2);
  if (opts.out) writeFileSync(resolve(process.cwd(), opts.out), `${out}\n`);
  console.log(out);
  process.exit(verdict.gate === 'PASS' ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
