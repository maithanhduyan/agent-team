/**
 * T06 test harness.
 *
 * Locates the T03/T04/T05 implementation modules and loads fixtures.
 * The implementation landed in `agent-desktop/src/**` as TypeScript
 * (TASK-7174 / Redmine #35); candidate paths are probed in order and
 * the first hit wins. The .ts modules import each other with `./x.js`
 * specifiers, so importing them requires the tsx loader — run-suite.mjs
 * injects it when it is resolvable in the project's dependency tree.
 * When nothing is found the suite reports the dependency as unavailable
 * and skips (with reason) instead of failing — the fixtures remain fully
 * self-checked.
 */
import { existsSync, readFileSync, mkdtempSync, cpSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_DIR = dirname(fileURLToPath(import.meta.url)); // tests/lib
export const TESTS_DIR = join(HARNESS_DIR, '..'); // tests
export const FIXTURES = join(TESTS_DIR, 'fixtures');
export const AGENT_DESKTOP = resolve(TESTS_DIR, '..');

/**
 * Candidate implementation entry points, per task (probed in order).
 *
 * The primary candidate for every task is the public API aggregator
 * `agent-desktop/src/index.ts` — it re-exports the full T03/T04/T05
 * surface (see its export list). The task-specific .ts modules and the
 * legacy .mjs/.js paths are kept as fallbacks for other layouts.
 */
const IMPL_CANDIDATES = {
  T03: [
    'src/index.ts',
    'src/core-writer.ts',
    'src/sessions-writer.ts',
    'src/memory/writer.mjs',
    'src/memory/writer.js',
    'src/writer.mjs',
    'src/writer.js',
    'memory/writer.mjs',
    'memory/writer.js',
  ],
  T04: [
    'src/index.ts',
    'src/search-memory.ts',
    'src/grep-logs.ts',
    'src/hot-facts.ts',
    'src/memory/search.mjs',
    'src/memory/search.js',
    'src/search.mjs',
    'src/search.js',
  ],
  T05: [
    'src/index.ts',
    'src/consolidation.ts',
    'src/memory/consolidation.mjs',
    'src/memory/consolidation.js',
    'src/consolidation.mjs',
    'src/consolidation.js',
  ],
};

/** Dependency status per task, mirroring Redmine (#29/#30/#31). */
export const DEPENDENCIES = {
  T03: { redmine: 29, title: 'T03 core memory module' },
  T04: { redmine: 30, title: 'T04 tools search_memory + grep_logs' },
  T05: { redmine: 31, title: 'T05 consolidation job' },
};

export function findImpl(task) {
  const candidates = IMPL_CANDIDATES[task] ?? [];
  for (const rel of candidates) {
    const p = join(AGENT_DESKTOP, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

export function skipReason(task) {
  const d = DEPENDENCIES[task];
  return `SKIPPED: ${d.title} (Redmine #${d.redmine}) not found at the probed implementation paths (src/index.ts, ...). The .ts modules need the tsx loader (run-suite.mjs injects it); without it the fixtures for this section remain self-checked.`;
}

export function fixturePath(name) {
  return join(FIXTURES, name);
}

export function loadJson(name) {
  return JSON.parse(readFileSync(fixturePath(name), 'utf8'));
}

export function loadJsonl(name) {
  return readFileSync(fixturePath(name), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

export function loadText(name) {
  return readFileSync(fixturePath(name), 'utf8');
}

export function copyFixtureDirToTemp() {
  // Build a throwaway MEMORY_DIR copy for tests that mutate state.
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 't06-memory-'));
  cpSync(join(FIXTURES, 'memory'), dir, { recursive: true });
  return dir;
}
