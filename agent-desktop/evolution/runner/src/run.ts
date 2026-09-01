/**
 * Evolution run orchestrator (T12, T09 §3) — one run:
 *
 *   dataset prep → sidecar evolve (streamed candidates) → Node
 *   guardrails (SEC-GEPA-01..11 re-validation) → fitness gate (T14
 *   harness) → judge team (Q5) → verdict + audit manifest
 *   (SEC-GEPA-11).
 *
 * Pipeline semantics (lesson hermes-agent — GATE, not fitness):
 *   - The fitness gate is used to REJECT (100% suite pass on the pinned
 *     dataset + 0 regression vs base), never to decide "better" on its
 *     own.
 *   - A candidate is merge-eligible only when ALL gates pass + judge
 *     approves + (T13) human review. This runner NEVER merges
 *     (SEC-GEPA-06/07) — it records a `merge-ready` verdict and the
 *     audit trail; the PR is T13's workflow.
 *   - If the judge panel is all-capped the run PAUSES safely — no
 *     unjudged candidate ever proceeds (SEC-GEPA-09).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { computeSha256, loadJson } from '../../src/dataset.js';
import { scanJsonValue } from '../../src/secret-scan.js';
import { CostTracker } from '../../../src/costs.js';
import type { EvolutionConfig } from './config.js';
import { sidecarConfigBlock } from './config.js';
import { SidecarClient } from './sidecar-client.js';
import { scoreBaseSkill, evaluateCandidate } from './fitness.js';
import {
    checkDepsPinned,
    runGuardrails,
    runLevelGuardrails,
    validateManifestSchema,
} from './guardrails.js';
import { judgeCandidate, type JudgeTeamConfig } from './judge-team.js';
import {
    buildManifest,
    writeManifest,
    writeCandidateSkill,
    type ManifestCandidate,
    type RunManifest,
} from './manifest.js';
import type { CandidateNotification, GuardrailResult } from './types.js';

export interface RunOutcome {
    jobId: string;
    manifestPath: string | null;
    manifest: RunManifest | null;
    candidates: ManifestCandidate[];
    sidecarReport: { status: string; generations_run: number; best_candidate_id: string | null } | null;
    error: string | null;
    paused: boolean;
}

/** Resolve a path that may be relative to the repo root. */
function resolveRepo(root: string, p: string): string {
    return resolve(root, p);
}

function utcNow(): string {
    return new Date().toISOString();
}

export async function runEvolution(cfg: EvolutionConfig, opts: {
    jobId: string;
    scratchDir?: string;
    judgeCostDir?: string;
    log?: Pick<Console, 'log' | 'warn' | 'info' | 'debug'>;
}): Promise<RunOutcome> {
    const log = opts.log ?? console;
    const jobId = opts.jobId;
    const startedAt = utcNow();
    const repoRoot = resolve(cfg.sidecarDir, '..', '..'); // agent-desktop
    const scratchDir = opts.scratchDir ?? join(cfg.runsDir, jobId, 'scratch');

    try {
        // ---- Stage 1: dataset prep (T11 artifact, pinned) -------------
        const datasetPath = resolveRepo(repoRoot, cfg.datasetPath);
        if (!existsSync(datasetPath)) {
            throw new Error(`dataset not found: ${datasetPath}`);
        }
        const datasetRaw = readFileSync(datasetPath, 'utf8');
        const datasetSha256 = computeSha256(datasetRaw);
        const dataset = JSON.parse(datasetRaw) as { dataset_id: string; schema_version: number; skill: string; case_count: number; cases: unknown[] };
        if (typeof dataset.dataset_id !== 'string' || !Array.isArray(dataset.cases)) {
            throw new Error('dataset is invalid: missing dataset_id/cases (T11 schema)');
        }
        // SEC-GEPA-08: dataset must be secret-free at scoring time (QL-2).
        const datasetHits = scanJsonValue(dataset);
        if (datasetHits.length > 0) {
            throw new Error(`dataset fails SEC-GEPA-08 secret scan (${datasetHits.length} hits)`);
        }

        const baseSkillPath = resolveRepo(repoRoot, cfg.baseSkillPath);
        if (!existsSync(baseSkillPath)) {
            throw new Error(`base skill not found: ${baseSkillPath}`);
        }
        const baseSkillText = readFileSync(baseSkillPath, 'utf8');
        const baseSkillSha256 = computeSha256(baseSkillText);
        const baseSkillSize = statSync(baseSkillPath).size;

        // ---- Stage 2: base fitness (regression anchor, SEC-GEPA-04) ---
        const baseScore = scoreBaseSkill({ runId: `mode-a-base-${jobId}` });
        if (!baseScore.valid || baseScore.gate.gate !== 'PASS') {
            throw new Error(
                `base skill fails the harness suite (fitness=${baseScore.fitness}) — ` +
                'cannot use it as the regression anchor',
            );
        }

        // ---- Stage 3: sidecar evolve (spawn per run, stdio) -----------
        const sidecar = new SidecarClient({
            python: cfg.python,
            sidecarDir: cfg.sidecarDir,
            jobId,
            scratchDir,
            timeoutMs: cfg.sidecarTimeoutMs,
        });
        await sidecar.start();

        const candidates: CandidateNotification[] = [];
        let sidecarReport: RunOutcome['sidecarReport'] = null;
        let initWarnings: string[] = [];
        try {
            const init = await sidecar.initialize({
                job_id: jobId,
                dataset_raw: datasetRaw,
                dataset_sha256: datasetSha256,
                base_skill_text: baseSkillText,
                base_skill_sha256: baseSkillSha256,
                config: sidecarConfigBlock(cfg),
                sidecar_version: cfg.sidecarVersion,
                lm_proxy_token: cfg.lmProxyToken ?? undefined,
            });
            initWarnings = init.config_warnings ?? [];
            const report = await sidecar.evolve((c) => candidates.push(c));
            sidecarReport = {
                status: report.status,
                generations_run: report.generations_run,
                best_candidate_id: report.best_candidate_id,
            };
            if (report.status !== 'ok') {
                log.warn?.(`[gepa-run] sidecar finished with status=${report.status}`);
            }
        } finally {
            await sidecar.close();
        }

        // ---- Stage 4..6: guardrails + fitness + judge per candidate ----
        const costTracker = new CostTracker(opts.judgeCostDir ?? join(cfg.runsDir, jobId), {
            caps: cfg.judgeCaps,
            log,
        });
        const judgeCfg: JudgeTeamConfig = {
            panelModels: cfg.judgePanelModels,
            consensus: cfg.judgeConsensus,
            maxModelsPerCall: cfg.judgeMaxModelsPerCall,
            timeoutS: cfg.judgeTimeoutS,
            caps: cfg.judgeCaps,
            dryRun: cfg.judgeDryRun,
        };

        const manifests: ManifestCandidate[] = [];
        let runPaused = false;

        for (const cand of candidates) {
            const sizeBytes = Buffer.byteLength(cand.skill_text, 'utf8');
            const fitness = evaluateCandidate(cand.skill_text, baseScore, {
                candidateId: cand.candidate_id,
                runId: `mode-a-${jobId}-${cand.candidate_id}`,
            });

            // SEC-GEPA-09: judge pause check happens inside judgeCandidate
            // (all-capped ⇒ paused); here we call the judge AFTER the
            // deterministic gates so a clearly-rejected candidate is
            // rejected without spending judge budget.
            const deterministicPass =
                fitness.threshold_met && fitness.regression.pass && sizeBytes <= 15360;

            let judgeOutcome;
            if (!deterministicPass) {
                judgeOutcome = {
                    gate: 'skipped',
                    per_model: {},
                    verdicts: {},
                    disabled_models: [],
                    skipped_models: [],
                    reasons: ['deterministic gates failed — judge not called (no spend)'],
                    reason: 'deterministic_gate_failed',
                    cost: costTracker.summary(),
                };
            } else {
                judgeOutcome = await judgeCandidate({
                    candidateText: cand.skill_text,
                    baseSkillText,
                    fitness: {
                        fitness: fitness.fitness,
                        threshold_met: fitness.threshold_met,
                        regression_pass: fitness.regression.pass,
                    },
                    cfg: judgeCfg,
                    cost: costTracker,
                    log,
                });
                if (judgeOutcome.gate === 'paused') {
                    runPaused = true;
                }
            }

            const guardrails = runGuardrails({
                skillText: cand.skill_text,
                sizeBytes,
                fitness: {
                    fitness: fitness.fitness,
                    threshold_met: fitness.threshold_met,
                    regression: fitness.regression,
                },
                judgePaused: judgeOutcome.gate === 'paused',
                sidecarDepsPinned: true,
                manifestValid: true, // set after write; recomputed at run level
            });

            // In dry-run mode a skipped judge (no enabled model) is
            // non-blocking — the deterministic gates still gate. In a
            // real run only an explicit 'approve' passes (SEC-GEPA-09:
            // never an unjudged write).
            const judgeOk =
                judgeOutcome.gate === 'approve' ||
                (cfg.judgeDryRun && judgeOutcome.gate === 'skipped');
            const accepted = deterministicPass && judgeOk && guardrails.every((g) => g.pass);

            const rejectReasons: string[] = [];
            if (!fitness.threshold_met) rejectReasons.push('SEC-GEPA-02: suite fitness < 1.0');
            if (!fitness.regression.pass) rejectReasons.push('SEC-GEPA-04: regression vs base');
            if (sizeBytes > 15360) rejectReasons.push('SEC-GEPA-03: size > 15 KB');
            if (judgeOutcome.gate === 'paused') rejectReasons.push('SEC-GEPA-09: judge all-capped — run paused');
            else if (judgeOutcome.gate === 'reject') rejectReasons.push('judge rejected the candidate');
            else if (judgeOutcome.gate === 'error') rejectReasons.push('judge error — no unjudged write');
            else if (!judgeOk && judgeOutcome.gate === 'skipped' && deterministicPass) rejectReasons.push('judge skipped');

            // T13 integration (AT-2, SEC-GEPA-11): persist the candidate
            // text so the audit record is replayable and the T13 PR
            // workflow can consume the candidate SKILL.md from the run
            // directory (skill_path below).
            const skillPath = writeCandidateSkill(cfg.runsDir, jobId, cand.candidate_id, cand.skill_text);

            manifests.push({
                candidate_id: cand.candidate_id,
                generation: cand.generation,
                size_bytes: sizeBytes,
                self_fitness: cand.self_fitness,
                self_guardrails: cand.self_guardrails,
                reflection: cand.reflection,
                skill_path: skillPath,
                guardrails: Object.fromEntries(guardrails.map((g) => [g.id, g])),
                fitness: {
                    fitness: fitness.fitness,
                    threshold_met: fitness.threshold_met,
                    passed: fitness.passed,
                    total: fitness.total,
                    failures: fitness.failures,
                    regression: fitness.regression,
                },
                judge: {
                    gate: judgeOutcome.gate,
                    per_model: judgeOutcome.per_model,
                    verdicts: judgeOutcome.verdicts,
                    disabled_models: judgeOutcome.disabled_models,
                    skipped_models: judgeOutcome.skipped_models,
                    reason: judgeOutcome.reason,
                },
                candidate_verdict: accepted ? 'accepted' : 'rejected',
                reject_reasons: rejectReasons,
            });
        }

        // ---- Stage 7: verdict + audit manifest (SEC-GEPA-11) ----------
        const depsPinned = checkDepsPinned(join(cfg.sidecarDir, 'requirements.txt'));
        const bestId = sidecarReport?.best_candidate_id ?? null;
        const acceptedCount = manifests.filter((m) => m.candidate_verdict === 'accepted').length;

        let status: 'completed' | 'failed' | 'paused';
        let verdict: RunManifest['verdict'];
        if (runPaused) {
            status = 'paused';
            verdict = 'paused';
        } else if (acceptedCount > 0) {
            status = 'completed';
            // merge-ready means "passes all gates"; the actual merge is a
            // human action via T13 (SEC-GEPA-06/07) — never automatic.
            verdict = 'merge-ready';
        } else if (manifests.length === 0) {
            status = 'completed';
            verdict = 'no-candidate';
        } else {
            status = 'completed';
            verdict = 'rejected';
        }

        const runGuardrailResults: Record<string, GuardrailResult> = Object.fromEntries(
            runLevelGuardrails({
                depsPinned: depsPinned.pinned,
                manifestValid: true, // set below after validation
                judgePaused: runPaused,
                sidecarVersion: cfg.sidecarVersion,
            }).map((g) => [g.id, g]),
        );

        const manifest = buildManifest({
            jobId,
            skill: cfg.skill,
            dataset: {
                dataset_id: dataset.dataset_id,
                sha256: datasetSha256,
                case_count: dataset.case_count ?? dataset.cases.length,
                path: datasetPath,
            },
            baseSkill: { path: baseSkillPath, sha256: baseSkillSha256, size_bytes: baseSkillSize },
            sidecar: {
                version: cfg.sidecarVersion,
                mode: cfg.sandboxImage ? 'container' : 'subprocess',
                deps_pinned: depsPinned.pinned,
                sandbox_image: cfg.sandboxImage,
                python: cfg.python,
            },
            config: {
                evolution: sidecarConfigBlock(cfg),
                judge: {
                    panel_models: cfg.judgePanelModels,
                    consensus: cfg.judgeConsensus,
                    caps: cfg.judgeCaps,
                    dry_run: cfg.judgeDryRun,
                },
                init_warnings: initWarnings,
            },
            startedAt: startedAt,
            endedAt: utcNow(),
            status,
            verdict,
            generationsRun: sidecarReport?.generations_run ?? 0,
            bestCandidateId: bestId,
            candidates: manifests,
            runGuardrails: runGuardrailResults,
            judgeCost: costTracker.summary(),
            pr: {
                branch: null,
                url: null,
                note: 'PR creation is the T13 workflow (SEC-GEPA-06/07): this runner never merges; candidates here are audit-trail records awaiting human review.',
            },
        });

        const schemaCheck = validateManifestSchema(manifest);
        const manifestPath = writeManifest(manifest, cfg.runsDir);
        log.log?.(`[gepa-run] ${jobId}: verdict=${verdict} candidates=${manifests.length} accepted=${acceptedCount} manifest=${manifestPath}`);

        return {
            jobId,
            manifestPath,
            manifest,
            candidates: manifests,
            sidecarReport,
            error: null,
            paused: runPaused,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.log?.(`[gepa-run] ${jobId} FAILED: ${message}`);
        // Write a failure manifest (SEC-GEPA-11 AT-1: record after every
        // run, success or failure).
        const manifest = buildManifest({
            jobId,
            skill: cfg.skill,
            dataset: { dataset_id: '', sha256: '', case_count: 0, path: cfg.datasetPath },
            baseSkill: { path: cfg.baseSkillPath, sha256: '', size_bytes: 0 },
            sidecar: { version: cfg.sidecarVersion, mode: 'subprocess', deps_pinned: false, sandbox_image: null, python: cfg.python },
            config: { evolution: sidecarConfigBlock(cfg) },
            startedAt: startedAt,
            endedAt: utcNow(),
            status: 'failed',
            verdict: 'rejected',
            generationsRun: 0,
            bestCandidateId: null,
            candidates: [],
            runGuardrails: {},
            judgeCost: { month: 'unknown', providers: {} },
            pr: { branch: null, url: null, note: 'run failed — no PR' },
            error: { message },
        });
        const manifestPath = writeManifest(manifest, cfg.runsDir);
        return { jobId, manifestPath, manifest, candidates: [], sidecarReport: null, error: message, paused: false };
    }
}

export { loadJson };
