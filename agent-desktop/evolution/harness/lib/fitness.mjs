/**
 * Fitness function (ADR-016 / T09 §5.2, SEC-GEPA-02).
 *
 *   fitness(c) = ( Σ_i w_i · pass_i ) / ( Σ_i w_i )   ∈ [0, 1]
 *
 * with `w_i ∈ (0,1]` the case weight and `pass_i ∈ {0,1}` the binary
 * outcome. Weights default to uniform (w_i = 1); the dataset manifest
 * may assign higher weights to safety-critical cases (EFS / junction /
 * service-password) for **ranking** only — the acceptance threshold
 * (1.0 = 100% pass) does not depend on weights (T09 §5.2/§5.3).
 *
 * Consumed by T12 (fitness gate): given a harness result (Mode A or B)
 * it returns the fitness and the gate verdict against the hard
 * threshold 1.0 (SEC-GEPA-02).
 */
import { validate } from './validate.mjs';
import { loadSchema } from './manifest.mjs';

/** Binary outcome from a case record: pass_i = 1 iff status === 'pass'. */
export function passOf(caseRecord) {
  return caseRecord.status === 'pass' ? 1 : 0;
}

/**
 * Compute fitness from an array of case records
 * (each: {id, scenario, status, weight}).
 * Returns { fitness, passedWeight, totalWeight, passed, total, failures }.
 */
export function fitnessOfCases(cases) {
  let passedWeight = 0;
  let totalWeight = 0;
  const failures = [];
  for (const c of cases) {
    const w = typeof c.weight === 'number' && c.weight > 0 ? c.weight : 1;
    totalWeight += w;
    if (passOf(c) === 1) passedWeight += w;
    else failures.push({ id: c.id, scenario: c.scenario, status: c.status });
  }
  const fitness = totalWeight === 0 ? 0 : passedWeight / totalWeight;
  return {
    fitness,
    passedWeight,
    totalWeight,
    passed: cases.filter((c) => passOf(c) === 1).length,
    failed: cases.filter((c) => passOf(c) !== 1).length,
    total: cases.length,
    failures,
  };
}

/**
 * Fitness of a full harness result document (schema-validated first).
 * Returns { valid, errors, fitness, threshold_met, details } — `valid`
 * is false when the result document fails schema validation.
 */
export function fitnessOfResult(result) {
  const schema = loadSchema('result');
  const { valid, errors } = validate(result, schema);
  if (!valid) {
    return { valid: false, errors, fitness: 0, threshold_met: false, details: null };
  }
  const details = fitnessOfCases(result.cases);
  const threshold_met = details.fitness === 1.0 && details.total > 0;
  return { valid: true, errors: [], fitness: details.fitness, threshold_met, details };
}

/** Gate verdict (SEC-GEPA-02): fitness must be exactly 1.0 (100% pass). */
export function gate(result) {
  const { valid, errors, fitness, threshold_met, details } = fitnessOfResult(result);
  return {
    gate: threshold_met ? 'PASS' : 'REJECT',
    threshold: 1.0,
    fitness,
    threshold_met,
    valid,
    errors,
    details,
  };
}
