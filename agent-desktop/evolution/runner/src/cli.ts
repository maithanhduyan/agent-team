#!/usr/bin/env node
/**
 * GEPA evolution runner CLI (T12, TASK-9053 / Redmine #47).
 *
 * Runs one evolution run end-to-end: dataset (T11, pinned) → sidecar
 * evolve (Python, stdio JSON-RPC) → Node guardrails (SEC-GEPA-01..11)
 * → fitness gate (T14 harness) → judge team (Q5) → audit manifest
 * (SEC-GEPA-11).
 *
 * Usage (from agent-desktop/):
 *   npm run evolve:run -- --job evo_20260901_01
 *   EVOLUTION_GENERATIONS=1 EVOLUTION_POPULATION_SIZE=4 \
 *     npm run evolve:run -- --job evo_smoke_01 --dry-run
 *
 * Flags:
 *   --job <id>       job id (default `evo_<yyyymmdd>_<seq>`)
 *   --dry-run        judge dry-run (record verdicts, never block)
 *   --help           usage
 *
 * Exit codes: 0 = run completed (verdict merge-ready/rejected/
 * no-candidate), 1 = run failed, 2 = paused (all judge models capped),
 * 3 = config/usage error.
 */

import { loadEvolutionConfig } from './config.js';
import { runEvolution } from './run.js';

function usage(): void {
    console.log(`Usage: node --import tsx evolution/runner/src/cli.ts [--job <id>] [--dry-run] [--help]`);
}

function parseArgs(argv: string[]): { job?: string; dryRun: boolean; help: boolean } {
    const out = { job: undefined as string | undefined, dryRun: false, help: false };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--job') out.job = argv[++i];
        else if (a === '--dry-run') out.dryRun = true;
        else if (a === '--help') out.help = true;
        else {
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

    let cfg;
    try {
        cfg = loadEvolutionConfig(process.env);
    } catch (err) {
        console.error(`config error: ${err instanceof Error ? err.message : err}`);
        process.exit(3);
    }
    if (args.dryRun) {
        process.env.EVOLUTION_JUDGE_DRY_RUN = '1';
        cfg = loadEvolutionConfig(process.env);
    }

    const now = new Date();
    const jobId =
        args.job ??
        `evo_${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}_${Math.floor(Math.random() * 1000)}`;

    const outcome = await runEvolution(cfg, { jobId });

    if (outcome.error) {
        console.error(`run failed: ${outcome.error}`);
        process.exit(1);
    }
    console.log(`verdict: ${outcome.manifest?.verdict}`);
    console.log(`manifest: ${outcome.manifestPath}`);
    if (outcome.paused) {
        console.error(`run paused: all judge models capped (SEC-GEPA-09) — no unjudged candidate`);
        process.exit(2);
    }
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
