/**
 * Suite runner — executes the full manifest against a behavior and
 * produces the unified result document (schema `result.schema.json`).
 *
 * For every case: fresh sandbox → run the case check → record
 * `{id, scenario, status, weight, expected, actual, captured_output,
 * duration_ms}`. The summary + fitness are computed by
 * `lib/fitness.mjs` (fitness(c) = Σ w_i·pass_i / Σ w_i; threshold 1.0).
 */
import { loadManifest } from './manifest.mjs';
import { buildCases } from './cases.mjs';
import { createSandbox } from './sandbox.mjs';
import { fitnessOfCases } from './fitness.mjs';

const HARNESS_VERSION = '1.0.0';

/**
 * Run the whole suite against `behavior` (object with the reference
 * interface). `candidate` is optional metadata for the result document
 * (T12: the skill under test — base skill or candidate).
 * Returns the full result document (already fitness-summarized).
 */
export function runSuite(behavior, { candidate = null, runId = null, startedAt = null } = {}) {
  const manifest = loadManifest();
  const cases = buildCases();
  const started = startedAt ?? new Date().toISOString();
  const results = [];

  for (const meta of cases) {
    const sandbox = createSandbox();
    const t0 = process.hrtime.bigint();
    let outcome;
    try {
      if (!meta.check) {
        outcome = {
          status: 'skip',
          expected: meta.pass_criteria,
          actual: 'no Mode A check implemented for this case id',
          captured: ['case has no executable check — see harness README'],
        };
      } else {
        outcome = meta.check(sandbox, behavior);
      }
    } catch (err) {
      outcome = {
        status: 'error',
        expected: meta.pass_criteria,
        actual: `check threw: ${err.message}`,
        captured: [`${err.stack ?? err}`],
      };
    } finally {
      sandbox.destroy();
    }
    const durationMs = Number(process.hrtime.bigint() - t0) / 1e6;
    results.push({
      id: meta.id,
      scenario: meta.scenario,
      status: outcome.status,
      weight: meta.weight,
      expected: outcome.expected,
      actual: outcome.actual,
      captured_output: outcome.captured ?? [],
      duration_ms: Math.round(durationMs * 1000) / 1000,
    });
  }

  const details = fitnessOfCases(results);
  const ended = new Date().toISOString();
  const result = {
    schema_version: '1.0',
    harness_version: HARNESS_VERSION,
    manifest_version: manifest.manifest_version,
    mode: 'A',
    run_id: runId ?? `mode-a-${Date.now()}`,
    skill: manifest.skill,
    candidate,
    started_at: started,
    ended_at: ended,
    cases: results,
    summary: {
      total: details.total,
      passed: details.passed,
      failed: details.failed,
      skipped: results.filter((c) => c.status === 'skip').length,
      errors: results.filter((c) => c.status === 'error').length,
      fitness: Math.round(details.fitness * 1e6) / 1e6,
      threshold_met: details.fitness === 1.0 && details.total > 0,
    },
  };
  return result;
}

export { HARNESS_VERSION };
