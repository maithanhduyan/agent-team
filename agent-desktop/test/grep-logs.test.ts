import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GrepLogsError, grepLogs, lineTimestamp, re2SafetyError } from '../src/grep-logs.js';

let seq = 0;

/** Build a temp memory dir + runs dir with fixed fixture files. */
async function makeFixture() {
    const root = await mkdtemp(path.join(tmpdir(), `mem-grep-${seq++}-`));
    const memoryDir = path.join(root, 'memory');
    const runsDir = path.join(root, 'runs');
    await mkdir(memoryDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });

    await writeFile(path.join(memoryDir, 'sessions.jsonl'), [
        '{"id":"evt_1","ts":"2026-09-01T10:00:00.000Z","session_id":"ses_a","type":"observation","provenance":"user_stated","importance":0.9,"valid_from":"2026-09-01T10:00:00.000Z","valid_to":null,"content":{"text":"Owner prefers Vietnamese.","kind":"preference"},"source":{"kind":"user","ref":"telegram:chat:1"}}',
        '{"id":"evt_2","ts":"2026-09-10T10:00:00.000Z","session_id":"ses_a","type":"observation","provenance":"tool_output","importance":0.7,"valid_from":"2026-09-10T10:00:00.000Z","valid_to":null,"content":{"text":"Install failed on EFS.","kind":"fact"},"source":{"kind":"tool","ref":"tool:read_file"}}',
        '{"id":"evt_3","ts":"2026-09-12T10:00:00.000Z","session_id":"ses_b","type":"observation","provenance":"user_stated","importance":0.6,"valid_from":"2026-09-12T10:00:00.000Z","valid_to":null,"content":{"text":"Coffee temperature.","kind":"fact"},"source":{"kind":"user","ref":"telegram:chat:2"}}',
        '',
    ].join('\n'), 'utf8');

    await writeFile(path.join(memoryDir, 'sessions-20260831.jsonl'), [
        '{"id":"evt_old","ts":"2026-08-20T10:00:00.000Z","session_id":"ses_z","type":"observation","provenance":"user_stated","importance":0.5,"valid_from":"2026-08-20T10:00:00.000Z","valid_to":null,"content":{"text":"Old Vietnamese note.","kind":"fact"},"source":{"kind":"user","ref":"telegram:chat:9"}}',
        '',
    ].join('\n'), 'utf8');

    await writeFile(path.join(memoryDir, 'core.md'), [
        '---',
        'memory_version: 1',
        'updated: 2026-09-01T00:00:00.000Z',
        'count: 1',
        '---',
        '',
        '# Core Memory',
        '',
        '<!-- fact_0001 -->',
        '## fact_0001: Vietnamese preference',
        '',
        '- **statement:** The owner communicates in Vietnamese.',
        '- **provenance:** user_stated',
        '- **importance:** 0.9',
        '- **hot:** true',
        '- **valid_from:** 2026-09-01T10:00:00.000Z',
        '- **valid_to:** (empty = open)',
        '- **status:** active',
        '',
    ].join('\n'), 'utf8');

    await writeFile(path.join(runsDir, 'run-1.log'), [
        '2026-09-11T08:00:00.000Z INFO session started channel=telegram',
        '2026-09-11T08:00:01.000Z DEBUG tool search_memory query=vietnamese',
        '2026-09-11T08:00:02.000Z INFO response: user prefers Vietnamese',
        '',
    ].join('\n'), 'utf8');

    return { root, memoryDir, runsDir };
}

test('grep_logs returns exact matching lines in file/line order (spec §7.2, US-MEM-004 AC-1)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    const out = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'memory' }, { runsDir });
    // archives first (asc), then sessions.jsonl, then core.md — line order within each.
    assert.deepEqual(out.matches.map((m) => m.file), ['sessions-20260831.jsonl', 'sessions.jsonl', 'core.md', 'core.md']);
    assert.deepEqual(out.matches.map((m) => m.line), [1, 1, 10, 12]); // core.md heading + statement
    // ts extraction: JSONL records carry ts; core.md lines do not
    assert.deepEqual(out.matches.map((m) => m.ts), ['2026-08-20T10:00:00.000Z', '2026-09-01T10:00:00.000Z', null, null]);
    assert.ok(out.matches[0].text.includes('Old Vietnamese note.'));
    assert.ok(out.matches[1].text.includes('Owner prefers Vietnamese.'));
    assert.ok(out.matches[2].text.includes('## fact_0001: Vietnamese preference'));
    assert.ok(out.matches[3].text.includes('The owner communicates in Vietnamese.'));
    assert.equal(out.meta.count, 4);
});

test('grep_logs context_lines returns before/after context (spec §7.2)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    const out = await grepLogs(memoryDir, { pattern: 'search_memory', files: 'runs', context_lines: 1 }, { runsDir });
    assert.equal(out.matches.length, 1);
    const m = out.matches[0];
    assert.deepEqual(m.before, ['2026-09-11T08:00:00.000Z INFO session started channel=telegram']);
    assert.deepEqual(m.after, ['2026-09-11T08:00:02.000Z INFO response: user prefers Vietnamese']);
    assert.equal(m.ts, '2026-09-11T08:00:01.000Z');
});

test('grep_logs honors limit (matches capped; context does not count) (spec §7.2)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    // "2026" appears in every timestamped line (memory + runs); limit=2 caps matches
    const out = await grepLogs(memoryDir, { pattern: '2026', files: 'all', limit: 2, context_lines: 0 }, { runsDir });
    assert.equal(out.matches.length, 2);
    assert.equal(out.meta.count, 2);
});

test('grep_logs case_sensitive (spec §7.2)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    // run log has lowercase "vietnamese" (query=vietnamese) and "Vietnamese" (response)
    const insensitive = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'runs' }, { runsDir });
    assert.equal(insensitive.matches.length, 2);

    const sensitiveLower = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'runs', case_sensitive: true }, { runsDir });
    assert.equal(sensitiveLower.matches.length, 1); // only the lowercase query=vietnamese line

    const sensitiveUpper = await grepLogs(memoryDir, { pattern: 'VIETNAMESE', files: 'runs', case_sensitive: true }, { runsDir });
    assert.deepEqual(sensitiveUpper.matches, []); // no uppercase VIETNAMESE anywhere
});

test('grep_logs files: memory | runs | all (spec §7.2, US-MEM-004 AC-3)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    const memoryOnly = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'memory' }, { runsDir });
    assert.ok(memoryOnly.matches.length > 0);
    assert.ok(memoryOnly.matches.every((m) => m.file !== 'run-1.log'));

    const runsOnly = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'runs' }, { runsDir });
    assert.ok(runsOnly.matches.length > 0);
    assert.ok(runsOnly.matches.every((m) => m.file === 'run-1.log'));

    const all = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'all' }, { runsDir });
    assert.ok(all.matches.length > runsOnly.matches.length);
});

test('grep_logs since filters by line timestamp; ts-less lines excluded when since set (§7.2)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    const since = await grepLogs(memoryDir, { pattern: 'vietnamese', files: 'memory', since: '2026-09-01T00:00:00.000Z' }, { runsDir });
    // evt_old (ts 2026-08-20) and core.md line (no determinable ts) are excluded
    assert.deepEqual(since.matches.map((m) => m.file), ['sessions.jsonl']);
    assert.equal(since.matches[0].ts, '2026-09-01T10:00:00.000Z');
});

test('grep_logs: invalid regex → error; RE2-unsafe patterns → error (spec §7.2, US-MEM-004 AC-2)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    await assert.rejects(() => grepLogs(memoryDir, { pattern: '([a-z' }, { runsDir }), GrepLogsError);
    await assert.rejects(() => grepLogs(memoryDir, { pattern: '' }, { runsDir }), GrepLogsError);

    // RE2-unsafe constructs
    await assert.rejects(() => grepLogs(memoryDir, { pattern: '(?=vietnamese)' }, { runsDir }), GrepLogsError); // lookahead
    await assert.rejects(() => grepLogs(memoryDir, { pattern: '(?<=viet)' }, { runsDir }), GrepLogsError);      // lookbehind
    await assert.rejects(() => grepLogs(memoryDir, { pattern: '(viet)\\1' }, { runsDir }), GrepLogsError);       // backreference
    await assert.rejects(() => grepLogs(memoryDir, { pattern: '(a+)+' }, { runsDir }), GrepLogsError);           // catastrophic backtracking
    await assert.rejects(() => grepLogs(memoryDir, { pattern: '(a*)*' }, { runsDir }), GrepLogsError);
    await assert.rejects(() => grepLogs(memoryDir, { pattern: 'a++' }, { runsDir }), GrepLogsError);             // possessive
});

test('re2SafetyError accepts safe patterns and rejects unsafe ones', () => {
    for (const safe of ['vietnamese', 'a+', '[a-z]+', 'a{2,4}', '^install.*efs$', '\\bword\\b', '\\p{L}+', 'a|b', '(foo|bar)+']) {
        assert.equal(re2SafetyError(safe), null, `expected ${safe} to be accepted`);
    }
    for (const unsafe of ['(?=x)', '(?!x)', '(?<=x)', '(?<!x)', '(a)\\1', '\\k<name>', '(a+)+', '(a*)*', '(a|b+)*', 'a*+']) {
        assert.ok(re2SafetyError(unsafe) !== null, `expected ${unsafe} to be rejected`);
    }
});

test('grep_logs: no matches → empty matches, not an error (spec §7.2)', async (t) => {
    const { root, memoryDir, runsDir } = await makeFixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    const out = await grepLogs(memoryDir, { pattern: 'quantum-zebra-xyz', files: 'all' }, { runsDir });
    assert.deepEqual(out.matches, []);
    assert.equal(out.meta.count, 0);
});

test('lineTimestamp extracts JSONL ts and ISO prefixes; null otherwise', () => {
    assert.equal(lineTimestamp('{"ts":"2026-09-01T10:00:00.000Z","x":1}'), '2026-09-01T10:00:00.000Z');
    assert.equal(lineTimestamp('2026-09-11T08:00:01.000Z DEBUG tool search_memory'), '2026-09-11T08:00:01.000Z');
    assert.equal(lineTimestamp('no timestamp here'), null);
    assert.equal(lineTimestamp('not json but has 2026-09-01T10:00:00.000Z inside'), '2026-09-01T10:00:00.000Z');
});
