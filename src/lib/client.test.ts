/**
 * `HttpClient` provisioning tests (plan §4, T1.1). Pure logic, no DOM:
 * `createClient()`'s same-origin fallback takes its origin as an injectable
 * parameter rather than reading the ambient `window.location` directly (bare
 * `bun test`/happy-dom, with no navigation, resolves `window.location.origin`
 * to the opaque-origin string `"null"`, not a usable URL). Exercises
 * `createClient()`/`setApiKey()` directly rather than through
 * `provideClient()`/`getClient()`, which need an active Svelte component
 * context — same convention `scopes.svelte.test.ts` (T1.2) uses for
 * `providePrincipalStore()`/`getPrincipalStore()`, covered later by the
 * app-shell's own component tests (T1.6).
 *
 * `HttpClient.headers` keys are lower-cased (`Headers`/Fetch-spec
 * normalization) — assertions below read `headers['authorization']`, not
 * `headers['Authorization']`.
 */
import { describe, expect, test } from 'bun:test';

import { createClient, getClient, provideClient, setApiKey } from './client.ts';
import type { WeftConsoleRuntimeConfig } from './config.ts';

describe('createClient — baseUrl resolution', () => {
  test('an empty baseUrl (same-origin, plan §3.3) resolves to the injected origin', () => {
    const client = createClient({ baseUrl: '' }, 'https://weft-console.example.com');
    expect(client.baseUrl).toBe('https://weft-console.example.com');
  });

  test('an explicit baseUrl is passed through unchanged', () => {
    const client = createClient({ baseUrl: 'https://weft.example.com' });
    expect(client.baseUrl).toBe('https://weft.example.com');
  });

  test('a Service Worker path-prefix baseUrl (plan §3.3) resolves against the injected origin', () => {
    const client = createClient({ baseUrl: '/weft' }, 'https://weft-console.example.com');
    expect(client.baseUrl).toBe('https://weft-console.example.com/weft');
  });
});

describe('createClient — eventTransport', () => {
  test('constructs successfully with eventTransport omitted (defaults to "auto")', () => {
    // `HttpClient` keeps its resolved `eventTransport` in a private field —
    // this asserts the observable contract (construction succeeds) rather
    // than reaching for the private value.
    expect(() => createClient({ baseUrl: 'https://weft.example.com' })).not.toThrow();
  });

  test('does not throw for any documented eventTransport value', () => {
    for (const eventTransport of ['auto', 'websocket', 'sse'] as const) {
      expect(() =>
        createClient({ baseUrl: 'https://weft.example.com', eventTransport }),
      ).not.toThrow();
    }
  });
});

describe('createClient — token', () => {
  test('with no token, no Authorization header is set', () => {
    const client = createClient({ baseUrl: 'https://weft.example.com' });
    expect(client.headers['authorization']).toBeUndefined();
  });

  test('a config token becomes a Bearer Authorization header', () => {
    const client = createClient({ baseUrl: 'https://weft.example.com', token: 'secret-token' });
    expect(client.headers['authorization']).toBe('Bearer secret-token');
  });
});

describe('createClient — headers', () => {
  test('config headers are sent on every request', () => {
    const client = createClient({
      baseUrl: 'https://weft.example.com',
      headers: { 'X-Custom-Header': 'value' },
    });
    expect(client.headers['x-custom-header']).toBe('value');
  });

  test('an explicit headers.Authorization wins over a config token (HttpClient precedence)', () => {
    const client = createClient({
      baseUrl: 'https://weft.example.com',
      token: 'from-token',
      headers: { Authorization: 'Bearer from-headers' },
    });
    expect(client.headers['authorization']).toBe('Bearer from-headers');
  });
});

describe('createClient — construction does not crash outside Bun (plan §4 upstream note)', () => {
  test('repeated construction is safe (the Bun.env shim never overwrites a real Bun global)', () => {
    expect(() => {
      createClient({ baseUrl: 'https://weft.example.com' });
      createClient({ baseUrl: 'https://weft.example.com' });
    }).not.toThrow();
    // Confirms the shim in ./client.ts never clobbers Bun's own real global —
    // if it did, unrelated Bun APIs used elsewhere in this same test process
    // would start failing after the first createClient() call.
    expect(typeof Bun.env).toBe('object');
  });
});

describe('setApiKey', () => {
  const config: WeftConsoleRuntimeConfig = { baseUrl: 'https://weft.example.com' };

  test('rebuilds the client with the entered key as a Bearer Authorization header', () => {
    const client = setApiKey(config, 'operator-entered-key');
    expect(client.headers['authorization']).toBe('Bearer operator-entered-key');
  });

  test('preserves the base config baseUrl', () => {
    const client = setApiKey(config, 'operator-entered-key');
    expect(client.baseUrl).toBe(config.baseUrl);
  });

  test('does not mutate the config object passed in', () => {
    const original = { ...config };
    setApiKey(config, 'operator-entered-key');
    expect(config).toEqual(original);
  });

  test('a fresh call with a different key produces an independent client', () => {
    const first = setApiKey(config, 'first-key');
    const second = setApiKey(config, 'second-key');
    expect(first.headers['authorization']).toBe('Bearer first-key');
    expect(second.headers['authorization']).toBe('Bearer second-key');
  });
});

describe('getClient — outside any provideClient() ancestor', () => {
  test('throws a clear error rather than returning undefined', () => {
    // Svelte's getContext() itself requires an active component-initialization
    // lifecycle; calling it here (no component, no provideClient() ancestor)
    // throws Svelte's own lifecycle error before getClient()'s own check runs
    // — still proves getClient() is not silently swallowing the missing case.
    expect(() => getClient()).toThrow();
  });
});

describe('provideClient — outside any component', () => {
  test("throws Svelte's own lifecycle error rather than silently no-op-ing", () => {
    const client = createClient({ baseUrl: 'https://weft.example.com' });
    expect(() => provideClient(client)).toThrow();
  });
});
