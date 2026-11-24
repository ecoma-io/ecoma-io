import { describe, expect, it } from 'vitest';

import { parseTemplateSchema, validateVariablesAgainstSchema } from './template-schema';

describe('parseTemplateSchema', () => {
  it('unparseable JSON → broken', () => {
    expect(parseTemplateSchema('{not json')).toEqual({ ok: false, reason: 'broken' });
  });

  it('missing type → broken', () => {
    expect(parseTemplateSchema('{"properties":{}}')).toEqual({ ok: false, reason: 'broken' });
  });

  it('valid object schema parsed', () => {
    const r = parseTemplateSchema('{"type":"object","properties":{"name":{"type":"string"}}}');
    expect(r.ok).toBe(true);
  });
});

describe('validateVariablesAgainstSchema', () => {
  const schema = parseTemplateSchema(
    '{"type":"object","properties":{"name":{"type":"string"},"age":{"type":"integer"},"active":{"type":"boolean"}},"required":["name"]}',
  );
  if (!schema.ok) throw new Error('schema must parse');

  it('valid variables pass', () => {
    const r = validateVariablesAgainstSchema(schema.schema, { name: 'An', age: 3, active: true });
    expect(r.ok).toBe(true);
  });

  it('missing required rejected', () => {
    expect(validateVariablesAgainstSchema(schema.schema, {}).ok).toBe(false);
  });

  it('no type coercion: 1 is not "1"', () => {
    expect(validateVariablesAgainstSchema(schema.schema, { name: 1 }).ok).toBe(false);
    expect(validateVariablesAgainstSchema(schema.schema, { name: '1' }).ok).toBe(true);
  });

  it('integer rejects float, number accepts float', () => {
    expect(validateVariablesAgainstSchema(schema.schema, { name: 'x', age: 1.5 }).ok).toBe(false);
  });
});
