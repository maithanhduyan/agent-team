#!/usr/bin/env node
/**
 * T06 golden-set generator (test-oracle math only — NOT product code).
 *
 * Computes the hand-derivable retrieval golden set from the T06 fixture
 * corpus, using exactly the contract formula of docs/memory-spec.md §7.1:
 *
 *   score = α·similarity + β·recency + γ·importance
 *   α=0.5 β=0.3 γ=0.2 (sum 1), HALF_LIFE=30 days
 *   recency = exp(-ln2 · age_days / HALF_LIFE)
 *
 * The similarity metric is PINNED by T06 (REQUIREMENTS.md §5.2 gap 2):
 * Jaccard over lowercased token sets (split on non-alphanumeric).
 * Searchable L2 records are those with `content.text` (type
 * `observation`); records without text are not rankable and are
 * excluded from `search_memory` results (T06 pinned contract note).
 *
 * Output: agent-desktop/tests/fixtures/golden-search.json and
 * agent-desktop/tests/fixtures/grep-golden.json (both committed).
 * The fixture selfcheck (00-fixture-selfcheck.test.mjs) re-runs this
 * math and asserts the committed golden files match within 1e-6, so the
 * golden set is reproducible.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures');
const MEM = join(FIXTURES, 'memory');

// ---- contract constants (spec §7.1 / §11) ----
export const CONTRACT = {
  alpha: 0.5,
  beta: 0.3,
  gamma: 0.2,
  halfLifeDays: 30,
  refNow: '2026-09-01T00:00:00.000Z',
  minScoreDefault: 0.1,
  topKDefault: 10,
  metric: 'jaccard-token-set-lowercased',
};

const REF_NOW = Date.parse(CONTRACT.refNow);
const DAY_MS = 86_400_000;

export function tokenize(s) {
  return String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}
export function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : inter / union;
}
export function recency(tsIso) {
  const ageDays = (REF_NOW - Date.parse(tsIso)) / DAY_MS;
  return Math.exp((-Math.log(2) * ageDays) / CONTRACT.halfLifeDays);
}
export function scoreOf(sim, rec, importance) {
  return CONTRACT.alpha * sim + CONTRACT.beta * rec + CONTRACT.gamma * importance;
}
const isActive = (r, nowMs = REF_NOW) =>
  Date.parse(r.valid_from) <= nowMs &&
  (r.valid_to === null || Date.parse(r.valid_to) > nowMs);

// ---- load corpus ----
function loadJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}
function loadCoreMd(path) {
  const text = readFileSync(path, 'utf8');
  const blocks = [];
  const markerRe = /<!--\s*(fact_\w+)\s*-->/g;
  let m;
  while ((m = markerRe.exec(text)) !== null) {
    const id = m[1];
    const chunk = text.slice(markerRe.lastIndex);
    const next = chunk.search(/<!--\s*fact_\w+\s*-->/);
    const body = (next === -1 ? chunk : chunk.slice(0, next)).trim();
    const kv = {};
    for (const line of body.split('\n')) {
      const mm = line.match(/^-\s+\*\*([a-z_]+):\*\*\s*(.*)$/);
      if (mm) kv[mm[1]] = mm[2];
    }
    blocks.push({ id, ...kv });
  }
  return blocks;
}

const sessions = [
  ...loadJsonl(join(MEM, 'sessions.jsonl')),
  ...loadJsonl(join(MEM, 'sessions-20260801.jsonl')),
];
const facts = loadCoreMd(join(MEM, 'core.md'));

const l2Searchable = sessions
  .filter((r) => r.type === 'observation' && typeof r.content?.text === 'string')
  .map((r) => ({
    id: r.id,
    tier: 'L2',
    ts: r.ts,
    provenance: r.provenance,
    importance: r.importance,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    text: r.content.text,
    session_id: r.session_id,
  }));
const l3 = facts
  .filter((f) => f.statement !== undefined)
  .map((f) => ({
    id: f.id,
    tier: 'L3',
    ts: f.valid_from,
    provenance: f.provenance,
    importance: parseFloat(f.importance),
    valid_from: f.valid_from,
    valid_to: f.valid_to === '' ? null : f.valid_to,
    status: f.status,
    text: f.statement,
    session_id: null,
  }));

function rank(query, pool, { includeExpired = false, minScore = 0.1, topK = 10 } = {}) {
  const scored = pool
    .filter((r) => (includeExpired ? true : isActive(r)))
    .map((r) => ({
      ...r,
      sim: jaccard(query, r.text),
      rec: recency(r.ts),
      score: scoreOf(jaccard(query, r.text), recency(r.ts), r.importance),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score || (Date.parse(b.ts) - Date.parse(a.ts)));
  return scored.slice(0, topK).map(({ sim, rec, ...r }) => ({ ...r }));
}

export { rank };

/** Load the searchable pool (L2 observations with text + L3 facts). */
export function loadSearchablePool() {
  const l2Searchable = sessions
    .filter((r) => r.type === 'observation' && typeof r.content?.text === 'string')
    .map((r) => ({
      id: r.id,
      tier: 'L2',
      ts: r.ts,
      provenance: r.provenance,
      importance: r.importance,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      text: r.content.text,
      session_id: r.session_id,
    }));
  const l3 = facts
    .filter((f) => f.statement !== undefined)
    .map((f) => ({
      id: f.id,
      tier: 'L3',
      ts: f.valid_from,
      provenance: f.provenance,
      importance: parseFloat(f.importance),
      valid_from: f.valid_from,
      valid_to: f.valid_to === '' ? null : f.valid_to,
      status: f.status,
      text: f.statement,
      session_id: null,
    }));
  return { l2: l2Searchable, l3, both: [...l2Searchable, ...l3] };
}

const Q = 'user prefers vietnamese chat messages';
const both = [...l2Searchable, ...l3];

const golden = {
  meta: {
    spec: 'docs/memory-spec.md §7.1 (acceptance §13)',
    formula: 'score = alpha*similarity + beta*recency + gamma*importance',
    pinned: 'T06 pins the similarity metric to Jaccard over lowercased token sets (REQUIREMENTS.md §5.2)',
    ...CONTRACT,
    generatedBy: 'agent-desktop/tests/lib/generate-golden.mjs',
  },
  query: Q,
  cases: {
    default: {
      params: {},
      expected: rank(Q, both),
    },
    includeExpired: {
      params: { include_expired: true },
      expected: rank(Q, both, { includeExpired: true }),
    },
    provenanceToolOutput: {
      params: { provenance: ['tool_output'] },
      expected: rank(Q, both.filter((r) => r.provenance === 'tool_output')),
    },
    provenanceUserStated: {
      params: { provenance: ['user_stated'] },
      expected: rank(Q, both.filter((r) => r.provenance === 'user_stated')),
    },
    since40d: {
      params: { since: '2026-07-23T00:00:00.000Z' },
      expected: rank(Q, both.filter((r) => Date.parse(r.ts) >= Date.parse('2026-07-23T00:00:00.000Z'))),
    },
    sessionOnly: {
      params: { session_id: 'ses_d4e5f6a7b8c90004' },
      expected: rank(Q, both.filter((r) => r.session_id === 'ses_d4e5f6a7b8c90004')),
    },
    topK2: {
      params: { top_k: 2 },
      expected: rank(Q, both, { topK: 2 }),
    },
    noMatchHighMinScore: {
      params: { query: 'quantum physics equations', min_score: 0.9 },
      expected: rank('quantum physics equations', both, { minScore: 0.9 }),
    },
    unknownLayerError: {
      params: { layers: ['L5'] },
      expected: { error: 'unknown layer: L5' },
    },
    emptyQueryError: {
      params: { query: '' },
      expected: { error: 'empty query' },
    },
  },
};

// ---- grep golden ----
function grepLines(files, pattern, { caseSensitive = false, contextLines = 2, limit = 100, since = null } = {}) {
  const re = new RegExp(pattern, caseSensitive ? '' : 'i');
  const out = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (out.length >= limit) break;
      if (since && !lines[i].includes('ts')) continue;
      if (re.test(lines[i])) {
        out.push({
          file: file.replace(join(FIXTURES, 'memory') + '/', 'memory/'),
          line: i + 1,
          text: lines[i],
          before: lines.slice(Math.max(0, i - contextLines), i),
          after: lines.slice(i + 1, i + 1 + contextLines),
        });
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

const memFiles = [
  join(MEM, 'sessions.jsonl'),
  join(MEM, 'sessions-20260801.jsonl'),
  join(MEM, 'core.md'),
];
const grepGolden = {
  meta: {
    spec: 'docs/memory-spec.md §7.2 (acceptance §13)',
    files: 'memory = sessions.jsonl + archives + core.md',
    re2: 'RE2-safe subset; invalid regex -> error',
    unranked: 'file/line order, capped by limit',
  },
  cases: {
    efs: {
      params: { pattern: 'EFS', files: 'memory', case_sensitive: true, context_lines: 2, limit: 100 },
      expected: grepLines(memFiles, 'EFS', { caseSensitive: true }),
    },
    vietnamese: {
      params: { pattern: 'vietnamese', files: 'memory', context_lines: 1, limit: 10 },
      expected: grepLines(memFiles, 'vietnamese', { contextLines: 1, limit: 10 }),
    },
    limitCap: {
      params: { pattern: 'evt_', files: 'memory', context_lines: 0, limit: 5 },
      expected: grepLines(memFiles, 'evt_', { contextLines: 0, limit: 5 }),
    },
    noMatch: {
      params: { pattern: 'zzzz_nothing_here', files: 'memory' },
      expected: [],
    },
    invalidRegexError: {
      params: { pattern: '[' },
      expected: { error: 'invalid regex' },
    },
    runsNotInFixtures: {
      params: { pattern: 'x', files: 'runs' },
      note: 'runs scope reads .agent-team/runs/*.log; fixtures ship no run logs — treated as no-match',
      expected: [],
    },
  },
};

writeFileSync(join(FIXTURES, 'golden-search.json'), JSON.stringify(golden, null, 2) + '\n');
writeFileSync(join(FIXTURES, 'grep-golden.json'), JSON.stringify(grepGolden, null, 2) + '\n');

// Only print the summary when run directly (importing for the fixture
// selfcheck must stay side-effect free).
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  for (const [name, c] of Object.entries(golden.cases)) {
    if (c.expected && Array.isArray(c.expected)) {
      console.log(
        `search.${name}: ${c.expected.length} hits ->`,
        c.expected.slice(0, 5).map((r) => `${r.id}=${r.score.toFixed(9)}`).join(', '),
      );
    } else {
      console.log(`search.${name}: ${JSON.stringify(c.expected)}`);
    }
  }
  console.log(`grep.efs: ${grepGolden.cases.efs.expected.length} matches`);
  console.log(`grep.vietnamese: ${grepGolden.cases.vietnamese.expected.length} matches`);
  console.log('golden files written under', FIXTURES);
}
