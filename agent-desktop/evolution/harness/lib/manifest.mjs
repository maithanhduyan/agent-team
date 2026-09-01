/**
 * T14 harness manifest loader + validator.
 *
 * Loads `manifest.json` (scenario classes + case list + version) and
 * validates it against `schema/manifest.schema.json`. Also exposes the
 * coverage checks T11 (dataset builder) consumes as its coverage
 * standard:
 *
 * - COV-1 (T10 §4.3): every declared scenario class must have at least
 *   one case; a dataset that lacks a class is invalid.
 * - every case belongs to **exactly one** declared class;
 * - per-class case counts meet the class `min_cases` floor.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validate } from './validate.mjs';

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url)); // evolution/harness/lib
export const HARNESS_ROOT = join(HARNESS_DIR, '..');

export const MANIFEST_PATH = join(HARNESS_ROOT, 'manifest.json');
export const MANIFEST_SCHEMA_PATH = join(HARNESS_ROOT, 'schema', 'manifest.schema.json');
export const RESULT_SCHEMA_PATH = join(HARNESS_ROOT, 'schema', 'result.schema.json');

let cached = null;

/** Load manifest.json (memoized). */
export function loadManifest() {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  return cached;
}

/** Load a schema file. */
export function loadSchema(which) {
  const p = which === 'manifest' ? MANIFEST_SCHEMA_PATH : RESULT_SCHEMA_PATH;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Validate the manifest: schema conformance + coverage invariants.
 * Returns { valid, errors, classes, casesByClass }.
 */
export function validateManifest() {
  const manifest = loadManifest();
  const errors = [];

  // 1. Schema conformance.
  const schema = loadSchema('manifest');
  const { valid, errors: schemaErrors } = validate(manifest, schema);
  if (!valid) errors.push(...schemaErrors);

  // 2. Class ids are unique.
  const classIds = manifest.scenario_classes.map((c) => c.id);
  const dupClasses = classIds.filter((id, i) => classIds.indexOf(id) !== i);
  if (dupClasses.length) errors.push(`duplicate scenario class ids: ${[...new Set(dupClasses)].join(', ')}`);

  // 3. Case ids unique; each case belongs to exactly one declared class;
  //    case.scenario must be a declared class id.
  const caseIds = manifest.cases.map((c) => c.id);
  const dupCases = caseIds.filter((id, i) => caseIds.indexOf(id) !== i);
  if (dupCases.length) errors.push(`duplicate case ids: ${[...new Set(dupCases)].join(', ')}`);

  const classSet = new Set(classIds);
  const casesByClass = {};
  for (const cls of manifest.scenario_classes) casesByClass[cls.id] = [];

  for (const c of manifest.cases) {
    if (!classSet.has(c.scenario)) {
      errors.push(`case ${c.id}: scenario "${c.scenario}" is not a declared class`);
      continue;
    }
    casesByClass[c.scenario].push(c.id);
  }

  // 4. COV-1: every declared class has >= 1 case; per-class floor.
  for (const cls of manifest.scenario_classes) {
    const n = (casesByClass[cls.id] || []).length;
    if (n === 0) {
      errors.push(`COV-1: scenario class "${cls.id}" has NO cases — dataset would be invalid (T10 §4.3)`);
    } else if (n < cls.min_cases) {
      errors.push(`class "${cls.id}": ${n} cases < min_cases ${cls.min_cases}`);
    }
  }

  return { valid: errors.length === 0, errors, classes: manifest.scenario_classes, casesByClass, manifest };
}
