/**
 * SEC-GEPA-03 size guardrail — candidate SKILL.md ≤ 15 KB (T13 re-check).
 *
 * The threshold is FIXED at 15 360 bytes (T10 §8: `EVOLUTION_SIZE_LIMIT_BYTES`
 * "fixed, not raised"). The limit is shared with the T12 runner
 * (`runner/src/guardrails.ts`) so there is a single source of truth.
 *
 * How to verify (T10 §5 SEC-GEPA-03): script check (`wc -c` / equivalent)
 * on the candidate file in CI; oversized ⇒ reject (T10 §7.2 R-5).
 */

import { readFileSync } from 'node:fs';
import { SIZE_LIMIT_BYTES } from '../../runner/src/guardrails.js';

export { SIZE_LIMIT_BYTES };

export interface SizeCheckResult {
    id: 'SEC-GEPA-03';
    metric: string;
    threshold: string;
    actual: number;
    pass: boolean;
    evidence: string;
}

/** SEC-GEPA-03: byte-size check on a string (wc -c equivalent, UTF-8). */
export function checkSizeBytes(bytes: number): SizeCheckResult {
    return {
        id: 'SEC-GEPA-03',
        metric: 'candidate SKILL.md byte size',
        threshold: `<= ${SIZE_LIMIT_BYTES} (15 KB)`,
        actual: bytes,
        pass: bytes <= SIZE_LIMIT_BYTES,
        evidence: `wc -c equivalent on the candidate file; limit SEC-GEPA-03 (15 360 bytes fixed)`,
    };
}

/** SEC-GEPA-03: byte-size check on a candidate file. */
export function checkSizeFile(filePath: string): SizeCheckResult {
    const text = readFileSync(filePath, 'utf8');
    return checkSizeBytes(Buffer.byteLength(text, 'utf8'));
}

/**
 * CLI entry: `node --import tsx evolution/workflow/src/cli.ts size <file>`
 * exits 0 (pass) or 1 (reject, R-5).
 */
export function sizeCli(filePath: string): number {
    const r = checkSizeFile(filePath);
    // eslint-disable-next-line no-console
    console.log(
        `SEC-GEPA-03 size check: ${r.actual} bytes (limit ${SIZE_LIMIT_BYTES}) → ${r.pass ? 'PASS' : 'REJECT'}`,
    );
    return r.pass ? 0 : 1;
}
