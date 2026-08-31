/**
 * Reflection — compress raw L2 observations into a lesson record
 * `{context, error, fix}` (spec §8.3, acceptance §13 row 9).
 *
 * The reflection step uses a small LLM (default DeepSeek) via the
 * judge-team provider abstraction (§9.2). Reflections are
 * `model_inferred` by definition (R-PROV-4) and never graduate without
 * the judge gate.
 *
 * Two call shapes are supported:
 * 1. **Pre-shaped lesson** — input already has `{context, error, fix}`
 *    (e.g. a previous reflection or the T06 fixture): the shape is
 *    validated and returned; a provider (when given) may refine it but
 *    an unparseable provider response falls back to the validated input.
 * 2. **Raw observations** — input is a list of observation texts (the
 *    full job's stage 2): a provider is REQUIRED and its response must
 *    parse as `{context, error, fix}` (schema error otherwise).
 *
 * The returned lesson never contains secrets: prompts are built from
 * redacted observation text and the provider output is validated to the
 * three-string shape (SEC-KEY-02/SEC-LOG-01).
 */

import type { LLMProvider } from './llm-provider.js';

/** A validated reflection lesson (spec §8.3). */
export interface ReflectionLesson {
    context: string;
    error: string;
    fix: string;
}

/** Thrown when a reflection input/output fails the §8.3 shape contract. */
export class ReflectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReflectionError';
    }
}

/** Validate a value as a `{context, error, fix}` lesson (§8.3). */
export function validateReflection(input: unknown): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { ok: false, errors: ['reflection must be an object with {context, error, fix}'] };
    }
    const rec = input as Record<string, unknown>;
    for (const key of ['context', 'error', 'fix'] as const) {
        if (typeof rec[key] !== 'string' || rec[key].trim() === '') {
            errors.push(`reflection missing required key: ${key} (string, non-empty)`);
        }
    }
    return { ok: errors.length === 0, errors };
}

/** Parse + validate a provider response as a reflection lesson. */
export function parseReflectionText(
    text: string,
): { ok: true; reflection: ReflectionLesson } | { ok: false; error: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: 'malformed-json' };
    }
    const validation = validateReflection(parsed);
    if (!validation.ok) {
        return { ok: false, error: validation.errors.join('; ') };
    }
    const p = parsed as Record<string, unknown>;
    return {
        ok: true,
        reflection: {
            context: p.context as string,
            error: p.error as string,
            fix: p.fix as string,
        },
    };
}

/** Whether `input` already carries the pre-shaped lesson keys. */
function isPreShapedLesson(input: unknown): input is ReflectionLesson {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return false;
    }
    const rec = input as Record<string, unknown>;
    return typeof rec.context === 'string' && typeof rec.error === 'string' && typeof rec.fix === 'string';
}

/** Extract observation texts from a raw cluster (job stage 1 output). */
function observationTexts(input: unknown): string[] {
    if (Array.isArray(input)) {
        return input
            .map((item) => {
                if (typeof item === 'string') return item;
                if (typeof item === 'object' && item !== null) {
                    const text = (item as Record<string, unknown>).text;
                    return typeof text === 'string' ? text : JSON.stringify(item);
                }
                return String(item);
            })
            .filter((t) => t.trim() !== '');
    }
    if (typeof input === 'object' && input !== null) {
        const observations = (input as Record<string, unknown>).observations;
        if (Array.isArray(observations)) {
            return observationTexts(observations);
        }
    }
    return [];
}

/** Build the reflection prompt (spec §8.3). */
export function buildReflectPrompt(input: unknown): string {
    if (isPreShapedLesson(input)) {
        return [
            'You are a memory-consolidation reflector. A lesson with',
            'context/error/fix is provided below. Return it as STRICT JSON',
            '{"context":"...","error":"...","fix":"..."} (all three keys,',
            'non-empty strings), compressing each field to at most one',
            'sentence.',
            '',
            `context: ${input.context}`,
            `error: ${input.error}`,
            `fix: ${input.fix}`,
        ].join('\n');
    }
    const texts = observationTexts(input);
    const body = texts.length > 0
        ? texts.map((t, i) => `[${i + 1}] ${t}`).join('\n')
        : '(no observations)';
    return [
        'You are a memory-consolidation reflector. Compress the raw',
        'observations below into ONE lesson with STRICT JSON shape',
        '{"context":"...","error":"...","fix":"..."} (all three keys,',
        'non-empty strings). context = the situation, error = what went',
        'wrong or the gap, fix = the reusable correction.',
        '',
        '# Observations',
        body,
    ].join('\n');
}

/** Options for `reflect`. */
export interface ReflectOptions {
    /** LLM provider (required when `input` is NOT a pre-shaped lesson). */
    provider?: LLMProvider;
    /** Custom prompt (default: built from the input). */
    prompt?: string;
    /** Logger. */
    log?: Pick<Console, 'warn' | 'info' | 'debug'>;
}

/**
 * Produce a `{context, error, fix}` lesson from the input (spec §8.3).
 * See the module doc for the two call shapes.
 */
export async function reflect(input: unknown, opts: ReflectOptions = {}): Promise<ReflectionLesson> {
    const log = opts.log ?? console;
    const preShaped = isPreShapedLesson(input);
    const validation = validateReflection(input);

    if (preShaped && validation.ok) {
        // Pre-shaped lesson: validate, optionally refine via the provider,
        // fall back to the validated input when the provider output is
        // unparseable (deterministic contract for the T06 shape test).
        if (opts.provider) {
            const prompt = opts.prompt ?? buildReflectPrompt(input);
            try {
                const res = await opts.provider.generate({ prompt, temperature: 0, maxTokens: 1024 });
                const parsed = parseReflectionText(res.text);
                if (parsed.ok) {
                    return parsed.reflection;
                }
                log.warn?.(`[reflect] provider output not a valid reflection (${parsed.error}); using the validated input`);
            } catch (err) {
                log.warn?.(`[reflect] provider call failed (${err instanceof Error ? err.message : String(err)}); using the validated input`);
            }
        }
        return { context: input.context, error: input.error, fix: input.fix };
    }

    // Raw observations: the LLM is mandatory.
    if (!opts.provider) {
        throw new ReflectionError(
            `reflection schema invalid: ${validation.errors.join('; ')} — a provider is required to compress raw observations`,
        );
    }
    const prompt = opts.prompt ?? buildReflectPrompt(input);
    const res = await opts.provider.generate({ prompt, temperature: 0, maxTokens: 1024 });
    const parsed = parseReflectionText(res.text);
    if (!parsed.ok) {
        throw new ReflectionError(`reflection schema invalid: ${parsed.error}`);
    }
    return parsed.reflection;
}
