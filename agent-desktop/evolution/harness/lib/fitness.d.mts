/** Type declarations for the T14 harness `lib/fitness.mjs` (PR #31). */

export interface HarnessCaseRecord {
    id: string;
    scenario: string;
    status: 'pass' | 'fail' | 'skip' | 'error';
    weight: number;
    expected?: string;
    actual?: string;
    captured_output?: string[];
    duration_ms?: number;
}

export interface HarnessResult {
    schema_version: string;
    harness_version: string;
    manifest_version: string;
    mode: 'A' | 'B';
    run_id: string;
    skill: string;
    candidate: { id: string; kind: 'base' | 'candidate'; path: string | null; size_bytes: number | null } | null;
    started_at: string;
    ended_at: string;
    cases: HarnessCaseRecord[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        errors: number;
        fitness: number;
        threshold_met: boolean;
    };
}

export interface FitnessDetails {
    fitness: number;
    passedWeight: number;
    totalWeight: number;
    passed: number;
    failed: number;
    total: number;
    failures: Array<{ id: string; scenario: string; status: string }>;
}

export interface FitnessOfResult {
    valid: boolean;
    errors: string[];
    fitness: number;
    threshold_met: boolean;
    details: FitnessDetails | null;
}

export interface GateVerdict {
    gate: 'PASS' | 'REJECT';
    threshold: number;
    fitness: number;
    threshold_met: boolean;
    valid: boolean;
    errors: string[];
    details: FitnessDetails | null;
}

export function passOf(caseRecord: HarnessCaseRecord): 0 | 1;
export function fitnessOfCases(cases: HarnessCaseRecord[]): FitnessDetails;
export function fitnessOfResult(result: unknown): FitnessOfResult;
export function gate(result: unknown): GateVerdict;
