#!/usr/bin/env node
/**
 * T06 suite runner.
 *
 * Runs every *.test.mjs in this directory with the Node built-in test
 * runner (spec reporter) and exits non-zero on any failure.
 *
 * Usage:
 *   node agent-desktop/tests/run-suite.mjs
 *
 * Files:
 *   00-fixture-selfcheck.test.mjs  — certifies the fixtures (runs now, no impl)
 *   10-writer.test.mjs             — T03 writer (SKIPPED until Redmine #29 merges)
 *   20-search.test.mjs             — T04 search tools (SKIPPED until #30 merges)
 *   30-consolidation.test.mjs      — T05 consolidation (SKIPPED until #31 merges)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join(HERE, f));

console.log('T06 memory test suite — files under test:');
for (const f of files) console.log('  -', f.split('/').pop());

const res = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], {
  stdio: 'inherit',
  cwd: join(HERE, '..'), // agent-desktop
});

console.log('\nTraceability (acceptance mapping docs/memory-spec.md §13):');
console.log('  00-fixture-selfcheck  rows 1-15 fixture certification (self-contained)');
console.log('  10-writer             rows 1,2,3,4,13 + SEC-MEM-01   (T03 / Redmine #29)');
console.log('  20-search             rows 5,6,7,8 + SEC-MEM-01       (T04 / Redmine #30)');
console.log('  30-consolidation      rows 9,10,11,12,14,15           (T05 / Redmine #31)');

process.exit(res.status ?? 1);
