#!/usr/bin/env node
/**
 * GEPA judge real-panel CLI (TASK-9657 / Redmine #52, Q5) — run the
 * REAL multi-model judge panel (deepseek + gpt-4 + gemini-2.5-pro) on
 * 1–2 fixture verdicts and report per-model verdict + confidence +
 * USD cost. This is the acceptance-criterion-3 tool: keys are read
 * from the environment ONLY (`DEEPSEEK_API_KEY` / `OPENAI_API_KEY` /
 * `GEMINI_API_KEY`) — never from args, files, or config; nothing is
 * ever printed except model ids, verdicts and USD amounts
 * (SEC-KEY-01..03, SEC-LOG-01/02).
 *
 * Usage (from agent-desktop/):
 *   npm run evolve:judge-real -- --models deepseek,gpt-4,gemini-2.5-pro
 *   npm run evolve:judge-real -- --models deepseek,gpt-4,gemini-2.5-pro --json
 *
 * Flags:
 *   --models <a,b,c>   panel priority order (default: JUDGE_PANEL_MODELS
 *                      env, else `deepseek`)
 *   --base <path>      base skill markdown (default: fixture)
 *   --candidate <path> candidate SKILL.md (default: fixture)
 *   --consensus <m>    any | majority (default: JUDGE_CONSENSUS env, else any)
 *   --json             machine-readable report (stdout)
 *   --help             usage
 *
 * Exit codes: 0 = panel produced a verdict (approve/reject/error —
 *                report printed), 2 = paused (all models capped,
 *                SEC-GEPA-09), 3 = no enabled provider (keys missing)
 *                or usage/config error.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CostTracker } from '../../../src/costs.js';
import { defaultProviders, type LLMProvider } from '../../../src/llm-provider.js';
import {
    parseJudgeCapUsd,
    parseJudgeConsensus,
    parseJudgeMaxModelsPerCall,
    parseJudgePanelModels,
    parseJudgeTimeoutS,
} from '../../../src/config.js';
import { judgeCandidate, type JudgeTeamConfig } from './judge-team.js';
import type { JudgeGateOutcome } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures', 'judge-real');

function usage(): void {
    console.log(`Usage: node --import tsx evolution/runner/src/judge-real.ts [--models a,b,c] [--base <path>] [--candidate <path>] [--consensus any|majority] [--json] [--help]`);
}

function parseArgs(argv: string[]): {
    models?: string[];
    base?: string;
    candidate?: string;
    consensus?: 'any' | 'majority';
    json: boolean;
    help: boolean;
} {
    const out = { models: undefined as string[] | undefined, base: undefined as string | undefined, candidate: undefined as string | undefined, consensus: undefined as 'any' | 'majority' | undefined, json: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--models') {
            out.models = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        } else if (a === '--base') {
            out.base = argv[++i];
        } else if (a === '--candidate') {
            out.candidate = argv[++i];
        } else if (a === '--consensus') {
            const v = argv[++i];
            if (v !== 'any' && v !== 'majority') {
                console.error(`invalid consensus: ${v}`);
                usage();
                process.exit(3);
            }
            out.consensus = v;
        } else if (a === '--json') {
            out.json = true;
        } else if (a === '--help') {
            out.help = true;
        } else {
            console.error(`unknown argument: ${a}`);
            usage();
            process.exit(3);
        }
    }
    return out;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        usage();
        return;
    }
    const env = process.env;

    // ---- config (env-only; caps share the JUDGE_CAP_*_USD surface) ----
    const panelModels = args.models ?? parseJudgePanelModels(env.JUDGE_PANEL_MODELS, ['deepseek']);
    const consensus = args.consensus ?? parseJudgeConsensus(env.JUDGE_CONSENSUS, 'any');
    const cfg: JudgeTeamConfig = {
        panelModels,
        consensus,
        maxModelsPerCall: parseJudgeMaxModelsPerCall(env.JUDGE_MAX_MODELS_PER_CALL, 3),
        timeoutS: parseJudgeTimeoutS(env.JUDGE_TIMEOUT_S, 30),
        caps: {
            deepseek: parseJudgeCapUsd(env.JUDGE_CAP_DEEPSEEK_USD, 15),
            gpt4: parseJudgeCapUsd(env.JUDGE_CAP_GPT4_USD, 10),
            gemini3: parseJudgeCapUsd(env.JUDGE_CAP_GEMINI3_USD, 10),
        },
        dryRun: false,
    };

    const basePath = args.base ?? join(FIXTURES, 'base-skill.md');
    const candidatePath = args.candidate ?? join(FIXTURES, 'candidate-skill.md');
    let baseSkillText: string;
    let candidateText: string;
    try {
        baseSkillText = readFileSync(basePath, 'utf8');
        candidateText = readFileSync(candidatePath, 'utf8');
    } catch (err) {
        console.error(`fixture/input read error: ${err instanceof Error ? err.message : err}`);
        process.exit(3);
    }

    // ---- providers: built from env keys ONLY (SEC-KEY-01..03) ---------
    const cost = new CostTracker(join(process.cwd(), 'evolution/runs/judge-real'), { caps: cfg.caps });
    const providers: Record<string, LLMProvider> = {};
    for (const p of defaultProviders({ costTracker: cost })) {
        providers[p.name] = p;
    }

    const report: Record<string, unknown> = {
        run_at: new Date().toISOString(),
        panel: panelModels,
        consensus,
        base: basePath,
        candidate: candidatePath,
    };

    const out: JudgeGateOutcome = await judgeCandidate({
        candidateText,
        baseSkillText,
        fitness: { fitness: 1.0, threshold_met: true, regression_pass: true },
        cfg,
        cost,
        providers,
    });

    // ---- report (model ids + verdicts + USD only — no keys) ----------
    report.gate = out.gate;
    report.reason = out.reason;
    report.skipped_models = out.skipped_models;
    report.disabled_models = out.disabled_models;
    report.per_model = out.per_model;
    report.verdicts = Object.fromEntries(
        Object.entries(out.verdicts).map(([name, v]) => [
            name,
            { verdict: v.verdict, confidence: v.confidence, reasons: v.reasons, has_suggested_edit: v.suggested_edit != null },
        ]),
    );
    report.cost = out.cost;

    if (args.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('GEPA judge — real multi-model panel (Q5, Redmine #52)');
        console.log(`panel: ${panelModels.join(', ')}  consensus=${consensus}`);
        console.log('');
        console.log('model            enabled  verdict   conf    cost(USD)   note');
        for (const name of panelModels) {
            const verdict = out.per_model[name];
            const v = out.verdicts[name];
            const spent = out.cost.providers[name]?.spentUsd ?? 0;
            let enabled = 'yes';
            let note = '';
            if (out.skipped_models.includes(name)) {
                enabled = 'no';
                note = 'skipped — key missing (SEC-KEY-03)';
            } else if (out.disabled_models.includes(name)) {
                enabled = 'no';
                note = 'auto-disabled — at monthly cap (SEC-COST-01)';
            }
            const conf = v ? v.confidence.toFixed(2) : '  -  ';
            const verdictStr = verdict ?? '  -  ';
            console.log(`${name.padEnd(16)} ${enabled.padEnd(7)} ${String(verdictStr).padEnd(9)} ${conf.padStart(4)}  ${spent.toFixed(6).padStart(10)}   ${note}`);
        }
        console.log('---------------------------------------------------------------');
        const total = Object.values(out.cost.providers).reduce((s, p) => s + p.spentUsd, 0);
        console.log(`gate: ${out.gate}${out.reason ? ` (${out.reason})` : ''}   total cost: $${total.toFixed(6)}`);
        console.log('cost file: evolution/runs/judge-real/costs-YYYYMM.json (no keys stored — SEC-KEY-02)');
    }

    // A requested model with no key lands in skipped_models (registered
    // but disabled); a capped model lands in disabled_models. Distinguish
    // "no keys at all" (usage error → 3) from "all capped" (pause → 2).
    const allRequestedSkippedNoKeys =
        panelModels.length > 0 && panelModels.every((m) => out.skipped_models.includes(m));
    if (allRequestedSkippedNoKeys) {
        console.error('no judge provider enabled — set DEEPSEEK_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY in the environment (keys are never logged)');
        process.exit(3);
    }
    if (out.gate === 'paused') {
        console.error('paused: all judge models capped (SEC-GEPA-09) — no unjudged write');
        process.exit(2);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(`judge-real failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
});
