/**
 * Minimal JSON Schema (draft-07 subset) validator.
 *
 * T14 harness: validates the manifest and the result JSON against the
 * committed schema files (`schema/manifest.schema.json`,
 * `schema/result.schema.json`) with **zero runtime dependencies** —
 * the same pattern as the T06 suite (node built-ins only). The schema
 * files are the canonical contract for T11/T12; this validator covers
 * the keyword subset the harness schemas use so CI can assert "the
 * emitted JSON validates against the schema" without npm installs.
 *
 * Supported keywords: type, const, enum, required, properties, items,
 * minItems, maxItems, minLength, pattern, minimum, maximum, format
 * (date-time only), additionalProperties (boolean).
 */

/** Validate `value` against `schema`. Returns {valid, errors:[...]}. */
export function validate(value, schema, path = '$') {
  const errors = [];
  walk(value, schema, path, errors);
  return { valid: errors.length === 0, errors };
}

function walk(value, schema, path, errors) {
  if (schema === true || schema === undefined || schema === null) return;
  if (typeof schema !== 'object') return;

  // type (string or array of allowed types)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) => typeMatches(t, value));
    if (!ok) {
      errors.push(`${path}: expected type ${JSON.stringify(types)}, got ${describe(value)}`);
      // Do not descend further into a wrongly-typed value.
      return;
    }
  }

  // const
  if ('const' in schema && schema.const !== value) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${describe(value)}`);
  }
  // enum
  if (schema.enum && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: value ${describe(value)} not in enum ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type === 'string' || typeof value === 'string') {
    if (typeof value === 'string') {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: length ${value.length} < minLength ${schema.minLength}`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${path}: "${value}" does not match pattern ${schema.pattern}`);
      }
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
        errors.push(`${path}: "${value}" is not a valid date-time`);
      }
    }
  }

  if (schema.type === 'number' || schema.type === 'integer' || typeof value === 'number') {
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
      }
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: ${value.length} items < minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: ${value.length} items > maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, errors));
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) errors.push(`${path}: missing required property "${key}"`);
      }
    }
    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) walk(value[key], sub, `${path}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push(`${path}: unexpected property "${key}"`);
      }
    }
  }
}

function typeMatches(t, value) {
  switch (t) {
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return `object(${Object.keys(value).join(',')})`;
  return `${typeof value} ${JSON.stringify(value)}`;
}
