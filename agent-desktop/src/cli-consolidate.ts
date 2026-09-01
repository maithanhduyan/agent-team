/**
 * Consolidation CLI (T05, spec §8) — run the sleep-time consolidation
 * job once from the command line:
 *
 *   node --import tsx src/cli-consolidate.ts        (dev)
 *   node dist/cli-consolidate.js                    (built)
 *
 * Reads the environment (`loadMemoryConfig`), builds the judge panel
 * from the registered providers (default DeepSeek; gpt-4/gemini-2.5-pro
 * when their keys are present — Q5), and runs `runConsolidationJob`. The
 * summary output contains per-model spend and run counts only — no
 * keys, no memory content (SEC-LOG-01/SEC-COST-02, ADR-010).
 *
 * Scheduling (`MEMORY_CONSOLIDATE_EVERY_MIN`) is the bridge's job
 * (T08); this CLI runs one pass.
 */

import { loadMemoryConfig } from './config.js';
import { defaultProviders, registerProvider, buildPanelFromConfig, clearProviders } from './llm-provider.js';
import { CostTracker } from './costs.js';
import { runConsolidationJob } from './consolidation.js';
import { redactSecrets } from './redact.js';

async function main(): Promise<void> {
    const cfg = loadMemoryConfig();
    const cost = new CostTracker(cfg.memoryDir);
    await cost.load();

    // Register the three optional provider modules (Q5 — missing keys
    // simply leave a model disabled/skipped; SEC-KEY-03).
    clearProviders();
    for (const provider of defaultProviders({ costTracker: cost })) {
        registerProvider(provider);
    }
    const providers: Record<string, ReturnType<typeof buildPanelFromConfig>[number]> = {};
    for (const p of buildPanelFromConfig(cfg, { providers: {} })) {
        providers[p.name] = p;
    }

    const result = await runConsolidationJob({
        memoryDir: cfg.memoryDir,
        cfg,
        providers,
    });

    const spend = cost.summary();
    const lines = [
        `consolidation run ${result.runId}:`,
        `  status: ${result.paused ? 'paused (judge panel unavailable — SEC-COST-01)' : 'ok'}`,
        `  new records: ${result.processed} (observations: ${result.observations})`,
        `  reflections: ${result.reflections}, candidates: ${result.candidates}`,
        `  graduated: ${result.graduated}, superseded: ${result.superseded}, rejected: ${result.rejected}`,
        `  decayed: ${result.decayed}, hot demoted: ${result.hot_demoted}`,
        `  duration: ${result.durationMs} ms`,
        `  spend this month (USD, per model):`,
    ];
    for (const [name, p] of Object.entries(spend.providers)) {
        lines.push(`    ${name}: $${p.spentUsd.toFixed(4)} / cap $${p.capUsd.toFixed(2)}${p.disabled ? ' (capped/disabled)' : ''}`);
    }
    process.stdout.write(`${redactSecrets(lines.join('\n'))}\n`);
}

main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`consolidation failed: ${redactSecrets(msg)}\n`);
    process.exitCode = 1;
});
