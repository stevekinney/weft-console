import { describe, expect, test } from 'bun:test';

import { isLargePayload, payloadByteLength } from './payload-size.ts';

describe('payloadByteLength', () => {
  test('counts ASCII text as one byte per character', () => {
    expect(payloadByteLength('abc')).toBe(3);
  });

  test('counts multi-byte UTF-8 characters correctly, unlike string.length', () => {
    const text = '🎉'; // 1 UTF-16 code unit pair, 4 UTF-8 bytes
    expect(payloadByteLength(text)).toBe(4);
    expect(text.length).not.toBe(4);
  });
});

describe('isLargePayload', () => {
  test('is false for small payloads', () => {
    expect(isLargePayload('{"a": 1}')).toBe(false);
  });

  test('is false exactly at the 100 KB threshold', () => {
    const text = 'a'.repeat(100 * 1024);
    expect(isLargePayload(text)).toBe(false);
  });

  test('is true just over the 100 KB threshold', () => {
    const text = 'a'.repeat(100 * 1024 + 1);
    expect(isLargePayload(text)).toBe(true);
  });
});
