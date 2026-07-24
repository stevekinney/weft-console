import { describe, expect, test } from 'bun:test';

import { parseJsonPayload } from './parse-json-payload.ts';

describe('parseJsonPayload', () => {
  test('treats empty text as valid', () => {
    expect(parseJsonPayload('')).toEqual({ ok: true });
  });

  test('treats whitespace-only text as valid', () => {
    expect(parseJsonPayload('   \n\t')).toEqual({ ok: true });
  });

  test('accepts valid JSON', () => {
    expect(parseJsonPayload('{"a": 1}')).toEqual({ ok: true });
  });

  test('accepts JSON scalars', () => {
    expect(parseJsonPayload('42')).toEqual({ ok: true });
    expect(parseJsonPayload('null')).toEqual({ ok: true });
    expect(parseJsonPayload('"a string"')).toEqual({ ok: true });
  });

  test('rejects malformed JSON with a message', () => {
    const result = parseJsonPayload('{"a": }');
    expect(result.ok).toBe(false);
    expect(typeof result.message).toBe('string');
    expect(result.message?.length).toBeGreaterThan(0);
  });

  test('rejects trailing commas', () => {
    expect(parseJsonPayload('{"a": 1,}').ok).toBe(false);
  });

  test('rejects unquoted keys', () => {
    expect(parseJsonPayload('{a: 1}').ok).toBe(false);
  });
});
