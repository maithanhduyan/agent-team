#!/usr/bin/env node
/**
 * T13 candidate-PR workflow CLI (TASK-9054 / Redmine #48).
 *
 * Usage (from agent-desktop/):
 *   npm run evolve:pr -- <command> [options]
 *
 * Commands:
 *   plan             plan a candidate PR (dry-run; no git, no network)
 *   open-pr          create the candidate branch + PR (real mode)
 *   check-metadata   validate PR metadata (§6.2) — auto-flag on missing fields
 *   check-approvals  verify owner + cto approvals (SEC-GEPA-06)
 *   no-auto-merge    structural scan for auto-merge paths (SEC-GEPA-07)
 *   size             SEC-GEPA-03 size check (≤ 15 KB)
 *   ab               SEC-GEPA-04 A/B regression check (0 regressions)
 *   activation       SEC-GEPA-05 no-hot-swap check vs merged registry state
 *   registry-state   (re)generate registry-state.json from the merged registry
 *   link-pr          write the PR link back into a run manifest (AT-3)
 *
 * Security invariants (SEC-GEPA-05/06/07): this CLI NEVER merges, NEVER
 * auto-merges, and never activates a candidate — it opens PRs, verifies
 * approvals, and checks activation against merged registry state only.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadWorkflowConfig, type WorkflowConfig } from './config.js';
import { planCandidatePr, executeOpenPr, loadRunManifest, findCandidate, resolveManifestPath, linkManifestToPr } from './open-pr.js';
import { checkMetadataCli } from './metadata.js';
import { checkApprovals, scanForAutoMerge, approvalsCli } from './review.js';
import { sizeCli } from './size.js';
import { abCli } from './ab.js';
import { activationCli, emptyRegistryState, type RegistryState } from './activation.js';
import { createGitHubClient } from './github.js';

function usage(): void {
    console.log(`Usage: node --import tsx evolution/workflow/src/cli.ts <command> [options]

Commands:
  plan             plan a candidate PR (dry-run)
  open-pr          create branch + PR (real mode; needs GITHUB_TOKEN)
  check-metadata   <pr-body.md>            validate §6.2 metadata (auto-flag)
  check-approvals  <reviews.json> --owner <login> --cto <login>
  no-auto-merge    [--dir <path>]...       structural scan (SEC-GEPA-07)
  size             <file>                  SEC-GEPA-03 check
  ab               <candidate-skill.md>    SEC-GEPA-04 A/B check
  activation       <state.json> <skill> <sha256>   SEC-GEPA-05 check
  registry-state   <registry-dir> [--out <state.json>] [--manifest <run.json>]
  link-pr          <manifest.json> --branch <b> [--url <u>] [--note <n>]

plan / open-pr options:
  --manifest <runs/<job>/manifest.json>   run record (SEC-GEPA-11)
  --candidate <candidate_id>
  --skill <file>                          candidate SKILL.md (or manifest skill_path)
  --dry-run                               plan only (default for plan)
  --no-push                               create branch+commit locally, no push/PR
  --target <branch>                       PR base (default develop)`);
}

function parseFlags(argv: string[]): Record<string, string> {
    const flags: Record<string, string> = {};
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) flags[key] = 'true';
            else {
                flags[key] = next;
                i += 1;
            }
        } else {
            flags[`_${Object.keys(flags).filter((k) => k.startsWith('_')).length}`] = a;
        }
    }
    return flags;
}

function positional(flags: Record<string, string>): string[] {
    return Object.keys(flags)
        .filter((k) => k.startsWith('_'))
        .sort()
        .map((k) => flags[k]);
}

function gitRemoteUrl(cfg: WorkflowConfig): string | null {
    try {
        return execFileSync('git', ['remote', 'get-url', cfg.remote], { encoding: 'utf8' }).trim();
    } catch {
        return null;
    }
}

function pendingApprovals(): ReturnType<typeof checkApprovals> {
    return {
        id: 'SEC-GEPA-06',
        metric: 'PR approvals (owner + cto) recorded on the PR before merge',
        threshold: '2 explicit approvals — owner AND cto',
        actual: '0 approvals (PR just opened)',
        pass: false,
        granted: [],
        missing: ['owner', 'cto'],
        reason: 'No approvals yet — owner AND cto must approve this PR (SEC-GEPA-06); merge is a manual human action',
    };
}

function loadCandidateSkill(manifestPath: string, candidateId: string, skillFlag: string | undefined): string {
    const { manifest } = loadRunManifest(manifestPath);
    const candidate = findCandidate(manifest, candidateId);
    if (skillFlag) return readFileSync(skillFlag, 'utf8');
    if (candidate.skill_path) return readFileSync(resolveManifestPath(manifestPath, candidate.skill_path), 'utf8');
    throw new Error('candidate SKILL.md not found: pass --skill <file> or set skill_path in the manifest');
}

async function cmdPlan(flags: Record<string, string>, cfg: WorkflowConfig): Promise<number> {
    const manifestPath = flags['manifest'];
    const candidateId = flags['candidate'];
    if (!manifestPath || !candidateId) {
        usage();
        return 3;
    }
    const skillText = loadCandidateSkill(manifestPath, candidateId, flags['skill']);
    const plan = planCandidatePr({
        manifestPath,
        candidateId,
        candidateSkillText: skillText,
        cfg,
        approvals: pendingApprovals(),
    });
    console.log(JSON.stringify({ branch: plan.branch, target: plan.target, title: plan.title, files: plan.files.map((f) => f.path), metadata: plan.metadata }, null, 2));
    return 0;
}

async function cmdOpenPr(flags: Record<string, string>, cfg: WorkflowConfig): Promise<number> {
    const manifestPath = flags['manifest'];
    const candidateId = flags['candidate'];
    if (!manifestPath || !candidateId) {
        usage();
        return 3;
    }
    const effective: WorkflowConfig = {
        ...cfg,
        dryRun: cfg.dryRun || flags['dry-run'] === 'true',
        noPush: cfg.noPush || flags['no-push'] === 'true',
        targetBranch: flags['target'] ?? cfg.targetBranch,
    };

    const skillText = loadCandidateSkill(manifestPath, candidateId, flags['skill']);

    const plan = planCandidatePr({
        manifestPath,
        candidateId,
        candidateSkillText: skillText,
        cfg: effective,
        approvals: pendingApprovals(),
    });

    const client = createGitHubClient({ token: effective.token, dryRun: effective.dryRun });
    const result = await executeOpenPr(plan, effective, client);
    if (result.pr) {
        console.log(`PR opened: ${result.pr.html_url}`);
        console.log(`branch: ${plan.branch} (no auto-merge — awaiting owner + cto approval, SEC-GEPA-06/07)`);
    } else if (effective.dryRun) {
        console.log('dry-run: no git/network changes made.');
    } else {
        console.log(`branch created + committed locally: ${plan.branch} (no push — noPush mode)`);
    }
    return 0;
}

function collectDirFiles(dir: string, out: Array<{ path: string; content: string }>, root = dir): void {
    for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) collectDirFiles(abs, out, root);
        else out.push({ path: relative(root, abs), content: readFileSync(abs, 'utf8') });
    }
}

function cmdNoAutoMerge(flags: Record<string, string>): number {
    // Default scan covers the workflow SOURCE only (test files contain
    // intentional synthetic merge-action strings for the scan test).
    const dirs = (flags['dir'] ?? 'evolution/workflow/src').split(',');
    const files: Array<{ path: string; content: string }> = [];
    for (const d of dirs) {
        if (d) collectDirFiles(d, files);
    }
    const r = scanForAutoMerge(files);
    console.log(`SEC-GEPA-07 no-auto-merge scan: ${r.hits.length} hit(s) in ${files.length} file(s) — ${r.pass ? 'PASS' : 'FAIL'}`);
    for (const h of r.hits) console.log(`  ${h.path}:${h.line} [${h.pattern}]`);
    return r.pass ? 0 : 1;
}

function cmdRegistryState(flags: Record<string, string>): number {
    const [registryDir] = positional(flags);
    const out = flags['out'];
    if (!registryDir) {
        usage();
        return 3;
    }
    const state: RegistryState = emptyRegistryState(`registry-state generated from ${registryDir}`);
    if (flags['manifest']) {
        const { manifest } = loadRunManifest(flags['manifest']);
        state.skills[manifest.skill] = {
            skill: manifest.skill,
            sha256: manifest.base_skill.sha256,
            source: 'merged',
            merged_at: manifest.ended_at,
            pr_url: manifest.pr?.url ?? null,
        };
    }
    const outPath = out ?? join(registryDir, 'registry-state.json');
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    console.log(`registry state written: ${outPath} (${Object.keys(state.skills).length} skill(s))`);
    return 0;
}

function cmdLinkPr(flags: Record<string, string>): number {
    const [manifestPath] = positional(flags);
    if (!manifestPath || !flags['branch']) {
        usage();
        return 3;
    }
    linkManifestToPr(manifestPath, {
        branch: flags['branch'],
        url: flags['url'] && flags['url'] !== 'true' ? flags['url'] : null,
        note: flags['note'] ?? 'PR linked by the T13 workflow (AT-3)',
    });
    console.log(`manifest updated: ${manifestPath}`);
    return 0;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
        usage();
        return;
    }
    const cmd = argv[0];
    const flags = parseFlags(argv.slice(1));

    if (cmd === 'size') return void process.exit(sizeCli(flags['_0']));
    if (cmd === 'ab') return void process.exit(abCli(flags['_0']));
    if (cmd === 'activation') {
        const [statePath, skill, sha256] = positional(flags);
        if (!statePath || !skill || !sha256) {
            usage();
            return void process.exit(3);
        }
        return void process.exit(activationCli(statePath, skill, sha256));
    }
    if (cmd === 'check-metadata') {
        if (!flags['_0']) {
            usage();
            return void process.exit(3);
        }
        return void process.exit(checkMetadataCli(flags['_0']));
    }
    if (cmd === 'check-approvals') {
        const [reviewsFile] = positional(flags);
        if (!reviewsFile) {
            usage();
            return void process.exit(3);
        }
        const owner = (flags['owner'] ?? 'maithanhduyan').split(',');
        const cto = (flags['cto'] ?? 'cto').split(',');
        return void process.exit(approvalsCli(reviewsFile, { owner, cto }));
    }
    if (cmd === 'no-auto-merge') return void process.exit(cmdNoAutoMerge(flags));
    if (cmd === 'registry-state') return void process.exit(cmdRegistryState(flags));
    if (cmd === 'link-pr') return void process.exit(cmdLinkPr(flags));

    const baseCfg = loadWorkflowConfig({ env: process.env, cwd: process.cwd() });
    const cfg =
        baseCfg.owner && baseCfg.repo
            ? baseCfg
            : loadWorkflowConfig({ env: process.env, cwd: process.cwd(), remoteUrl: gitRemoteUrl(baseCfg) });

    if (cmd === 'plan') return void process.exit(await cmdPlan(flags, cfg));
    if (cmd === 'open-pr') return void process.exit(await cmdOpenPr(flags, cfg));

    usage();
    process.exit(3);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
