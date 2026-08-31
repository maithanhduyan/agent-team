/**
 * T06 adapters — normalize the T03/T04/T05 implementation modules into
 * the contract surface the T06 suites assert against.
 *
 * The implementation does not exist yet (Redmine #29/#30/#31 In
 * Progress), so each adapter returns null and the suites skip with the
 * dependency reason. When a backend task lands, adjust the property
 * mapping below to the module's actual exports — the ASSERTIONS in the
 * suites are the spec contract and must not change.
 */
import { pathToFileURL } from 'node:url';
import { findImpl } from './harness.mjs';

async function loadModule(task) {
  const p = findImpl(task);
  if (!p) return null;
  return import(pathToFileURL(p).href);
}

/**
 * T03 writer surface (spec §5 append-only writer, §10.2 quarantine,
 * §6.2 core.md parse, SEC-MEM-01 render).
 */
export async function writerAdapter() {
  const mod = await loadModule('T03');
  if (!mod) return null;
  return {
    append: mod.append ?? mod.writeRecord ?? mod.appendRecord ?? mod.write,
    validate: mod.validate ?? mod.validateRecord ?? mod.checkSchema,
    readAll: mod.readAll ?? mod.loadRecords ?? mod.read,
    parseCoreMd: mod.parseCoreMd ?? mod.parseCore ?? mod.parse,
    renderBlock: mod.renderBlock ?? mod.formatMemoryBlock ?? mod.wrapMemory ?? mod.render,
    patterns: mod.INJECTION_PATTERNS ?? mod.defaultInjectionPatterns ?? mod.patterns,
  };
}

/**
 * T04 search surface (spec §7.1 search_memory, §7.2 grep_logs,
 * §6.3 hot facts).
 */
export async function searchAdapter() {
  const mod = await loadModule('T04');
  if (!mod) return null;
  return {
    searchMemory: mod.searchMemory ?? mod.search,
    grepLogs: mod.grepLogs ?? mod.grep,
    loadHotFacts: mod.loadHotFacts ?? mod.hotFacts ?? mod.readHotFacts,
    renderBlock: mod.renderBlock ?? mod.formatMemoryBlock ?? mod.wrapMemory ?? mod.render,
  };
}

/**
 * T05 consolidation surface (spec §8 pipeline, §9 judge gate, §10.3
 * conflict, §10.4 decay).
 */
export async function consolidationAdapter() {
  const mod = await loadModule('T05');
  if (!mod) return null;
  return {
    reflect: mod.reflect ?? mod.reflection,
    judge: mod.judge ?? mod.judgeGate ?? mod.runJudgeGate,
    runConsolidation: mod.runConsolidation ?? mod.consolidate ?? mod.run,
    applyDecay: mod.applyDecay ?? mod.decayJob,
    applyConflict: mod.applyConflict ?? mod.supersede,
    validateVerdict: mod.validateVerdict ?? mod.checkVerdict,
    resolvePanel: mod.resolvePanel ?? mod.buildPanel,
  };
}
