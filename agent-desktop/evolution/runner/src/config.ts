/**
 * GEPA evolution runner configuration (T12, TASK-9053 / Redmine #47).
 *
 * Env surface per T09 §9 (`docs/gepa-pipeline.md`) — reuses the T05
 * `JUDGE_*` surface (shared panel config, Q5/ADR-017) and adds the
 * `EVOLUTION_*` block. Defaults match T09 §9 / T10 §8 exactly; the
 * SEC-GEPA-02 fitness floor (1.0) and SEC-GEPA-03 size cap (15 KB)
 * are FIXED and cannot be lowered/raised.
 */

import { join, resolve } from 'node:path';
import {
    MemoryConfigError,
    parseJudgeCapUsd,
    parseJudgeConsensus,
    parseJudgeMaxModelsPerCall,
    parseJudgePanelModels,
    parseJudgeTimeoutS,
} from '../../../src/config.js';

/** SEC-GEPA-03 fixed size cap (15 KB = 15 360 bytes) — never raised. */
export const EVOLUTION_MAX_SKILL_BYTES_FIXED = 15360;
/** SEC-GEPA-02 fixed fitness floor — never lowered. */
export const EVOLUTION_FITNESS_THRESHOLD_FIXED = 1.0;

export interface EvolutionConfig {
    /** Skill to evolve (registry path; pilot `install-dsh`). */
    skill: string;
    /** Absolute path of the pinned eval dataset JSON (T11). */
    datasetPath: string;
    /** Absolute path of the base skill SKILL.md. */
    baseSkillPath: string;
    /** Run manifests dir (SEC-GEPA-11); default `<repo>/evolution/runs`. */
    runsDir: string;
    /** Python interpreter for the sidecar subprocess. */
    python: string;
    /** Sidecar package dir (where `gepa_sidecar/` lives). */
    sidecarDir: string;
    /** Sidecar version expected by the runner (handshake check). */
    sidecarVersion: string;
    /** Hard wall-clock timeout (ms) for one sidecar run; hung → kill (ADR-009 §6.3.4). */
    sidecarTimeoutMs: number;
    /** Python stdio line buffering via -u (avoid pipe buffering). */
    sidecarUnbuffered: boolean;
    /** Sandbox image digest (SEC-GEPA-10); null in subprocess mode. */
    sandboxImage: string | null;
    // ---- GEPA loop knobs (env-less, sent to the sidecar) ----
    populationSize: number;
    generations: number;
    elitism: number;
    fitnessTarget: number;
    evalSample: number;
    maxSkillBytes: number;
    randomSeed: number;
    // ---- judge (shared panel config, Q5/ADR-017) ----
    judgePanelModels: string[];
    judgeConsensus: 'any' | 'majority';
    judgeMaxModelsPerCall: number;
    judgeTimeoutS: number;
    judgeCaps: { deepseek: number; gpt4: number; gemini3: number };
    /** LM proxy URL for the sidecar (Node-controlled forwarder); null = MockLM. */
    lmProxyUrl: string | null;
    /** Short-lived LM proxy token (read-only; never logged, SEC-KEY-02). */
    lmProxyToken: string | null;
    /** When true, judge verdicts are recorded but never block (dry-run for tests). */
    judgeDryRun: boolean;
}

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new MemoryConfigError(`${name} must be a positive integer, got "${value}"`);
    }
    return n;
}

function parseFraction(name: string, value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === '') return fallback;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new MemoryConfigError(`${name} must be in [0,1], got "${value}"`);
    }
    return n;
}

/**
 * Load the evolution runner config. `baseDir` = agent-desktop root
 * (default process.cwd() when invoked from agent-desktop).
 */
export function loadEvolutionConfig(
    env: NodeJS.ProcessEnv = process.env,
    baseDir = process.cwd(),
): EvolutionConfig {
    const repoRoot = resolve(baseDir, '..');
    const defaultDataset = join(baseDir, 'evolution/datasets/install-dsh-v0.1.json');
    const defaultBaseSkill = join(baseDir, 'evolution/harness/fixtures/install-dsh/SKILL.md');
    const defaultRunsDir = join(baseDir, 'evolution/runs');
    const defaultSidecarDir = join(baseDir, 'evolution/sidecar');

    const datasetPath = env.EVOLUTION_DATASET?.trim() || defaultDataset;
    const baseSkillPath = env.EVOLUTION_BASE_SKILL?.trim() || defaultBaseSkill;
    const runsDir = env.EVOLUTION_RUNS_DIR?.trim() || defaultRunsDir;
    const sidecarDir = env.EVOLUTION_SIDECAR_DIR?.trim() || defaultSidecarDir;

    const maxSkillBytes = parsePositiveInt('EVOLUTION_MAX_SKILL_BYTES', env.EVOLUTION_MAX_SKILL_BYTES, EVOLUTION_MAX_SKILL_BYTES_FIXED);
    if (maxSkillBytes > EVOLUTION_MAX_SKILL_BYTES_FIXED) {
        throw new MemoryConfigError(
            `EVOLUTION_MAX_SKILL_BYTES ${maxSkillBytes} exceeds the SEC-GEPA-03 fixed cap ` +
            `${EVOLUTION_MAX_SKILL_BYTES_FIXED} (15 KB) — the cap cannot be raised`,
        );
    }
    const fitnessTarget = parseFraction('EVOLUTION_FITNESS_TARGET', env.EVOLUTION_FITNESS_TARGET, EVOLUTION_FITNESS_THRESHOLD_FIXED);
    if (fitnessTarget < EVOLUTION_FITNESS_THRESHOLD_FIXED) {
        throw new MemoryConfigError(
            `EVOLUTION_FITNESS_TARGET ${fitnessTarget} is below the SEC-GEPA-02 fixed floor ` +
            `${EVOLUTION_FITNESS_THRESHOLD_FIXED} — the PR gate always requires the full suite`,
        );
    }

    const judgePanelModels = parseJudgePanelModels(env.JUDGE_PANEL_MODELS, ['deepseek']);
    const sidecarTimeoutS = parsePositiveInt('EVOLUTION_SIDECAR_TIMEOUT_S', env.EVOLUTION_SIDECAR_TIMEOUT_S, 600);

    return {
        skill: env.EVOLUTION_SKILL?.trim() || 'install-dsh',
        datasetPath: resolve(repoRoot, datasetPath),
        baseSkillPath: resolve(repoRoot, baseSkillPath),
        runsDir: resolve(repoRoot, runsDir),
        python: env.EVOLUTION_SIDECAR_PYTHON?.trim() || 'python3',
        sidecarDir: resolve(repoRoot, sidecarDir),
        sidecarVersion: env.EVOLUTION_SIDECAR_VERSION?.trim() || '0.1.0',
        sidecarTimeoutMs: sidecarTimeoutS * 1000,
        sidecarUnbuffered: env.EVOLUTION_SIDECAR_UNBUFFERED !== '0',
        sandboxImage: env.EVOLUTION_SANDBOX_IMAGE?.trim() || null,
        populationSize: parsePositiveInt('EVOLUTION_POPULATION_SIZE', env.EVOLUTION_POPULATION_SIZE, 8),
        generations: parsePositiveInt('EVOLUTION_GENERATIONS', env.EVOLUTION_GENERATIONS, 3),
        elitism: parsePositiveInt('EVOLUTION_ELITISM', env.EVOLUTION_ELITISM, 2),
        fitnessTarget,
        evalSample: parseFraction('EVOLUTION_EVAL_SAMPLE', env.EVOLUTION_EVAL_SAMPLE, 1.0),
        maxSkillBytes,
        randomSeed: parsePositiveInt('EVOLUTION_RANDOM_SEED', env.EVOLUTION_RANDOM_SEED, 42),
        judgePanelModels,
        judgeConsensus: parseJudgeConsensus(env.JUDGE_CONSENSUS, 'any'),
        judgeMaxModelsPerCall: parseJudgeMaxModelsPerCall(env.JUDGE_MAX_MODELS_PER_CALL, 3),
        judgeTimeoutS: parseJudgeTimeoutS(env.JUDGE_TIMEOUT_S, 30),
        judgeCaps: {
            deepseek: parseJudgeCapUsd(env.JUDGE_CAP_DEEPSEEK_USD, 15),
            gpt4: parseJudgeCapUsd(env.JUDGE_CAP_GPT4_USD, 10),
            gemini3: parseJudgeCapUsd(env.JUDGE_CAP_GEMINI3_USD, 10),
        },
        lmProxyUrl: env.EVOLUTION_LM_PROXY_URL?.trim() || null,
        lmProxyToken: env.EVOLUTION_LM_PROXY_TOKEN?.trim() || null,
        judgeDryRun: env.EVOLUTION_JUDGE_DRY_RUN === '1',
    };
}

/** The env-less config block sent to the sidecar (T09 §4.3 — no keys). */
export function sidecarConfigBlock(cfg: EvolutionConfig): Record<string, unknown> {
    return {
        population_size: cfg.populationSize,
        generations: cfg.generations,
        elitism: cfg.elitism,
        fitness_target: cfg.fitnessTarget,
        eval_sample: cfg.evalSample,
        max_skill_bytes: cfg.maxSkillBytes ?? EVOLUTION_MAX_SKILL_BYTES_FIXED,
        random_seed: cfg.randomSeed,
        judge: { enabled: cfg.judgePanelModels.length > 0 },
        lm_proxy_url: cfg.lmProxyUrl ?? undefined,
        // lm_proxy_token is intentionally ABSENT: the block is recorded
        // in the audit trail (SEC-KEY-02 — never serialize the token);
        // the token travels separately in the initialize RPC and is
        // never persisted or logged.
    };
}
