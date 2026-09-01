/**
 * Skill registry layout + candidate-branch file set (T13, T10 §6.1).
 *
 * BR-1: each candidate goes to a DEDICATED branch
 *   `evolution/<skill>/<run-id>-<candidate>`; candidates never commit
 *   directly to `develop`.
 *
 * BR-2: the PR targets the skill registry (T09 §5.1 layout — the repo's
 *   `agents/skills/` dir) and contains ONLY:
 *     1. the candidate `SKILL.md`,
 *     2. the dataset version reference (`dataset.ref.json`),
 *     3. the run audit record (`run-audit-record.json`, SEC-GEPA-11).
 *
 * Nothing else is written to the candidate branch — no runner state, no
 * run artifacts, no secrets (SEC-GEPA-08).
 */

import type { RunManifest } from '../../runner/src/manifest.js';

/** Branch name for a candidate — BR-1: `evolution/<skill>/<run-id>-<candidate>`. */
export function candidateBranchName(skill: string, runId: string, candidateId: string): string {
    const slug = (s: string): string =>
        s
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9._/_-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^[-/]+|[-/]+$/g, '');
    return `evolution/${slug(skill)}/${slug(runId)}-${slug(candidateId)}`;
}

/** `SKILL.md` path in the registry for a skill. */
export function registrySkillPath(registryDir: string, skill: string): string {
    return `${registryDir}/${skill}/SKILL.md`;
}

/** Dataset version reference (BR-2 item 2). */
export function registryDatasetRefPath(registryDir: string, skill: string): string {
    return `${registryDir}/${skill}/dataset.ref.json`;
}

/** Run audit record (BR-2 item 3, SEC-GEPA-11). */
export function registryAuditRecordPath(registryDir: string, skill: string): string {
    return `${registryDir}/${skill}/run-audit-record.json`;
}

export interface BranchFile {
    /** Repo-root-relative path inside the candidate branch. */
    path: string;
    content: string;
}

export interface DatasetRef {
    dataset_id: string;
    version: string;
    sha256: string;
    case_count: number;
    path: string;
    note: string;
}

/** Dataset version reference written to the branch (BR-2 item 2). */
export function buildDatasetRef(manifest: RunManifest): DatasetRef {
    return {
        dataset_id: manifest.dataset.dataset_id,
        version: manifest.dataset.dataset_id, // dataset_id doubles as the pinned version id (COV-3)
        sha256: manifest.dataset.sha256,
        case_count: manifest.dataset.case_count,
        path: manifest.dataset.path,
        note: 'Pinned dataset for this evolution run (T10 §4.3 COV-3, SEC-GEPA-11): fitness and A/B regression were measured against this exact dataset hash.',
    };
}

/**
 * The candidate-branch file set (BR-2 — ONLY these three files):
 * candidate SKILL.md + dataset version reference + run audit record.
 */
export function buildBranchFileSet(opts: {
    registryDir: string;
    skill: string;
    candidateSkillText: string;
    manifest: RunManifest;
}): BranchFile[] {
    const { registryDir, skill, candidateSkillText, manifest } = opts;
    return [
        {
            path: registrySkillPath(registryDir, skill),
            content: candidateSkillText,
        },
        {
            path: registryDatasetRefPath(registryDir, skill),
            content: JSON.stringify(buildDatasetRef(manifest), null, 2) + '\n',
        },
        {
            path: registryAuditRecordPath(registryDir, skill),
            content: JSON.stringify(manifest, null, 2) + '\n',
        },
    ];
}
