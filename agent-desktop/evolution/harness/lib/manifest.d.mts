/** Type declarations for the T14 harness `lib/manifest.mjs` (PR #31). */

export interface HarnessScenarioClass {
    id: string;
    label: string;
    description: string;
    min_cases: number;
}

export interface HarnessManifestCase {
    id: string;
    scenario: string;
    weight: number;
    title: string;
    description: string;
    pass_criteria: string;
    planted: boolean;
    severity: string;
    modes: string[];
}

export interface HarnessManifest {
    schema_version: string;
    manifest_version: string;
    skill: string;
    description: string;
    scenario_classes: HarnessScenarioClass[];
    cases: HarnessManifestCase[];
    coverage: { min_cases_per_class: number; min_total: number; note: string };
}

export const HARNESS_ROOT: string;
export const MANIFEST_PATH: string;
export const MANIFEST_SCHEMA_PATH: string;
export const RESULT_SCHEMA_PATH: string;

export function loadManifest(): HarnessManifest;
export function loadSchema(which: 'manifest' | 'result'): Record<string, unknown>;
export function validateManifest(): {
    valid: boolean;
    errors: string[];
    classes: HarnessScenarioClass[];
    casesByClass: Record<string, string[]>;
    manifest: HarnessManifest;
};
