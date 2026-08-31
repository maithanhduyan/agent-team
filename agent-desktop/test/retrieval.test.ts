import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_ALPHA,
    DEFAULT_BETA,
    DEFAULT_GAMMA,
    DEFAULT_HALF_LIFE_DAYS,
    jaccardSimilarity,
    parseHalfLifeDays,
    parseRetrievalWeights,
    recencyScore,
    RetrievalConfigError,
    retrievalScore,
    tokenize,
    type RetrievalWeights,
} from '../src/retrieval.js';

const W: RetrievalWeights = { alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA, gamma: DEFAULT_GAMMA };

test('tokenize lowercases and splits on non-letter/number runs (§7.1)', () => {
    assert.deepEqual(tokenize('The owner prefers Vietnamese.'), ['the', 'owner', 'prefers', 'vietnamese']);
    assert.deepEqual(tokenize('  UPPER-case_123  '), ['upper', 'case', '123']);
    assert.deepEqual(tokenize('!!!---'), []);
    assert.deepEqual(tokenize('người dùng thích Tiếng Việt'), ['người', 'dùng', 'thích', 'tiếng', 'việt']);
});

test('jaccardSimilarity is deterministic and hand-computable (§7.1)', () => {
    // Q = {owner, prefers, vietnamese}; D = {the, owner, communicates, with, agent, in, vietnamese}
    // intersection = 2, union = 3 + 7 - 2 = 8 → 2/8 = 0.25
    const sim = jaccardSimilarity(
        tokenize('owner prefers vietnamese'),
        tokenize('The owner communicates with the agent in Vietnamese.'),
    );
    assert.ok(Math.abs(sim - 0.25) < 1e-12);
    // identical sets → 1; disjoint → 0; empty side → 0
    assert.equal(jaccardSimilarity(tokenize('a b'), tokenize('b a')), 1);
    assert.equal(jaccardSimilarity(tokenize('a'), tokenize('b c')), 0);
    assert.equal(jaccardSimilarity([], tokenize('anything')), 0);
});

test('recencyScore follows exp(-ln2·age/HALF_LIFE) with HALF_LIFE=30 days (§7.1)', () => {
    const now = '2026-09-15T00:00:00.000Z';
    // 30 days old → 0.5 exactly (the contract anchor)
    assert.ok(Math.abs(recencyScore('2026-08-16T00:00:00.000Z', now, 30) - 0.5) < 1e-12);
    // 60 days old → 0.25
    assert.ok(Math.abs(recencyScore('2026-07-17T00:00:00.000Z', now, 30) - 0.25) < 1e-12);
    // age 0 → 1
    assert.equal(recencyScore(now, now, 30), 1);
    // future-dated record clamps to age 0 → 1
    assert.equal(recencyScore('2026-09-20T00:00:00.000Z', now, 30), 1);
    // custom half-life: 15 days old with HALF_LIFE=15 → 0.5
    assert.ok(Math.abs(recencyScore('2026-08-31T00:00:00.000Z', now, 15) - 0.5) < 1e-12);
    // unparseable ts → 0 (deterministic fallback)
    assert.equal(recencyScore('not-a-date', now, 30), 0);
});

test('retrievalScore = α·similarity + β·recency + γ·importance — golden set within 1e-6 (spec §13/§7.1)', () => {
    // Hand-computed against the defaults α=0.5, β=0.3, γ=0.2:
    //   score = 0.5·sim + 0.3·recency + 0.2·importance
    const golden = [
        { sim: 3 / 7, recency: 0.5, importance: 0.9, expected: 0.5442857142857143 },
        { sim: 1.0, recency: 0.3535533905932738, importance: 0.6, expected: 0.7260660171779821 },
        { sim: 0.25, recency: 0.723634618720189, importance: 0.9, expected: 0.5220903856160567 },
        { sim: 4 / 7, recency: 0.8908987181403393, importance: 0.7, expected: 0.6929839011563875 },
        { sim: 4 / 7, recency: 0.8908987181403393, importance: 0.8, expected: 0.7129839011563875 },
    ];
    for (const { sim, recency, importance, expected } of golden) {
        const score = retrievalScore(sim, recency, importance, W);
        assert.ok(Math.abs(score - expected) <= 1e-6, `expected ${expected} ≈ ${score}`);
    }
});

test('parseRetrievalWeights defaults to 0.5/0.3/0.2 and honors env (§11)', () => {
    assert.deepEqual(parseRetrievalWeights({}), { alpha: 0.5, beta: 0.3, gamma: 0.2 });
    assert.deepEqual(parseRetrievalWeights({ MEMORY_ALPHA: '0.4', MEMORY_BETA: '0.4', MEMORY_GAMMA: '0.2' }),
        { alpha: 0.4, beta: 0.4, gamma: 0.2 });
    // invalid single var falls back to its default, keeping the sum at 1
    assert.deepEqual(parseRetrievalWeights({ MEMORY_ALPHA: 'abc' }),
        { alpha: 0.5, beta: 0.3, gamma: 0.2 });
});

test('parseRetrievalWeights rejects weights that do not sum to 1 (spec §7.1)', () => {
    assert.throws(() => parseRetrievalWeights({ MEMORY_ALPHA: '0.9', MEMORY_BETA: '0.3', MEMORY_GAMMA: '0.2' }),
        RetrievalConfigError);
    assert.throws(() => parseRetrievalWeights({ MEMORY_ALPHA: '-0.5' }), RetrievalConfigError);
    assert.throws(() => parseRetrievalWeights({ MEMORY_GAMMA: '2' }), RetrievalConfigError);
});

test('parseHalfLifeDays defaults to 30 and falls back on invalid input (§11)', () => {
    assert.equal(parseHalfLifeDays(undefined), DEFAULT_HALF_LIFE_DAYS);
    assert.equal(parseHalfLifeDays('15'), 15);
    assert.equal(parseHalfLifeDays(''), 30);
    assert.equal(parseHalfLifeDays('abc'), 30);
    assert.equal(parseHalfLifeDays('-7'), 30);
});
