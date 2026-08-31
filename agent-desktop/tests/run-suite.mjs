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
 * The T03/T04/T05 implementation is TypeScript (`agent-desktop/src/**`,
 * TASK-7174 / Redmine #35). The .ts sources import each other with
 * `./x.js` specifiers, which Node's native type stripping does not
 * rewrite, so the suites need the tsx loader to import the modules.
 * This runner resolves `tsx` from the project's own dependency tree
 * (agent-desktop/package.json devDependencies; `npm ci` installs it)
 * and forwards it with `--import`. When tsx is not installed the suites
 * degrade to SKIP with the dependency reason instead of crashing.
 *
 * Files:
 *   00-fixture-selfcheck.test.mjs  — certifies the fixtures (self-contained)
 *   10-writer.test.mjs             — T03 writer (Redmine #29)
 *   20-search.test.mjs             — T04 search tools (Redmine #30)
 *   30-consolidation.test.mjs      — T05 consolidation (Redmine #31)
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => join(HERE, f));

console.log('T06 memory test suite — files under test:');
for (const f of files) console.log('  -', f.split('/').pop());

// Resolve the tsx loader from the agent-desktop dependency tree so the
// .ts implementation modules can be imported (see header comment).
const require = createRequire(import.meta.url);
let loader = null;
try {
  loader = require.resolve('tsx');
  console.log(`tsx loader: ${loader}`);
} catch {
  console.warn('tsx not resolvable — .ts implementation suites will SKIP (npm ci in agent-desktop to install)');
}

const nodeArgs = loader ? ['--import', loader] : [];

const res = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...nodeArgs, ...files], {
  stdio: 'inherit',
  cwd: join(HERE, '..'), // agent-desktop
});

console.log('\nTraceability (acceptance mapping docs/memory-spec.md §13):');
console.log('  00-fixture-selfcheck  rows 1-15 fixture certification (self-contained)');
console.log('  10-writer             rows 1,2,3,4,13 + SEC-MEM-01   (T03 / Redmine #29)');
console.log('  20-search             rows 5,6,7,8 + SEC-MEM-01       (T04 / Redmine #30)');
console.log('  30-consolidation      rows 9,10,11,12,14,15           (T05 / Redmine #31)');

process.exit(res.status ?? 1);
