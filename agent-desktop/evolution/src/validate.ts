/**
 * Minimal JSON Schema (draft-07 subset) validator — zero dependencies.
 *
 * Used by the T11 dataset builder to validate eval-dataset records against
 * `contracts/eval-dataset.schema.json` (T10 §4.2 FMT-4: every record must
 * validate against the declared schema; T14 scoring consumes the same
 * schema). The subset covers exactly the keywords the contract schemas use:
 * `type`, `required`, `properties`, `additionalProperties`, `items`,
 * `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`,
 * `$ref` (local `#/definitions/...` only).
 *
 * Deterministic and side-effect free (CG-1: guardrail checks are
 * re-runnable from the audit trail alone).
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface ValidationError {
    path: string;
    message: string;
}

interface Schema {
    type?: string | string[];
    required?: string[];
    properties?: Record<string, Schema>;
    additionalProperties?: boolean | Schema;
    items?: Schema;
    enum?: JsonValue[];
    const?: JsonValue;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    $ref?: string;
    // Ignored keywords (allowed by the contract schemas).
    $schema?: string;
    $id?: string;
    title?: string;
    description?: string;
}

/** Resolve a local `#/definitions/<name>` reference against the root schema. */
function resolveRef(root: Schema, ref: string): Schema | null {
    if (!ref.startsWith('#/definitions/')) {
        return null;
    }
    const name = ref.slice('#/definitions/'.length);
    const defs = (root as { definitions?: Record<string, Schema> }).definitions;
    return defs?.[name] ?? null;
}

function typeOf(value: JsonValue): string {
    if (value === null) {
        return 'null';
    }
    if (Array.isArray(value)) {
        return 'array';
    }
    return typeof value;
}

function validateAgainst(schema: Schema, value: JsonValue, path: string, root: Schema, errors: ValidationError[]): void {
    // $ref first — the referenced schema takes over this node.
    if (schema.$ref) {
        const target = resolveRef(root, schema.$ref);
        if (!target) {
            errors.push({ path, message: `unresolvable $ref ${schema.$ref}` });
            return;
        }
        validateAgainst(target, value, path, root, errors);
        return;
    }

    if (schema.type !== undefined) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        const ok = types.some((t) => {
            if (t === 'integer') {
                return typeof value === 'number' && Number.isInteger(value);
            }
            return t === typeOf(value);
        });
        if (!ok) {
            errors.push({ path, message: `expected type ${types.join('|')}, got ${typeOf(value)}` });
            return;
        }
    }

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const obj = value as Record<string, JsonValue>;
        if (schema.required) {
            for (const key of schema.required) {
                if (!(key in obj)) {
                    errors.push({ path: `${path}.${key}`, message: `missing required property '${key}'` });
                }
            }
        }
        if (schema.properties) {
            for (const [key, propSchema] of Object.entries(schema.properties)) {
                if (key in obj) {
                    validateAgainst(propSchema, obj[key], `${path}.${key}`, root, errors);
                }
            }
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(obj)) {
                if (schema.properties && !(key in schema.properties)) {
                    errors.push({ path: `${path}.${key}`, message: `additional property '${key}' not allowed` });
                }
            }
        } else if (typeof schema.additionalProperties === 'object') {
            const additional = schema.additionalProperties;
            for (const [key, val] of Object.entries(obj)) {
                if (schema.properties && !(key in schema.properties)) {
                    validateAgainst(additional, val, `${path}.${key}`, root, errors);
                }
            }
        }
    }

    if (Array.isArray(value)) {
        if (schema.items) {
            const items = schema.items;
            value.forEach((item, i) => validateAgainst(items, item, `${path}[${i}]`, root, errors));
        }
    }

    if (schema.enum !== undefined && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
        errors.push({ path, message: `value not in enum ${JSON.stringify(schema.enum)}` });
    }
    if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
        errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
    }
    if (typeof value === 'string') {
        if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
            errors.push({ path, message: `value does not match pattern /${schema.pattern}/` });
        }
        if (schema.minLength !== undefined && value.length < schema.minLength) {
            errors.push({ path, message: `length ${value.length} < minLength ${schema.minLength}` });
        }
        if (schema.maxLength !== undefined && value.length > schema.maxLength) {
            errors.push({ path, message: `length ${value.length} > maxLength ${schema.maxLength}` });
        }
    }
    if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
        errors.push({ path, message: `${value} < minimum ${schema.minimum}` });
    }
}

/**
 * Validate `value` against `schema` (draft-07 subset). `root` is the schema
 * used to resolve local `#/definitions/...` references (defaults to
 * `schema` — pass the full contract schema when validating a sub-schema
 * like `#/definitions/record`). Returns the list of validation errors
 * (empty array = valid). Never throws for malformed schemas beyond what the
 * subset can express.
 */
export function validateJsonSchema(schema: Schema, value: JsonValue, root: Schema = schema): ValidationError[] {
    const errors: ValidationError[] = [];
    validateAgainst(schema, value, '$', root, errors);
    return errors;
}
