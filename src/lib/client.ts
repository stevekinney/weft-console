/**
 * `HttpClient` construction + Svelte-context provisioning (plan §4, T1.1).
 * Frozen after the Phase 1 Foundation gate — see PROJECT-BRIEF "Shared
 * contracts". Runtime config resolution lives in `./config.ts`; this module
 * turns that config into the app's single `HttpClient` and hands it out via
 * context, per PROJECT-BRIEF: "`getClient()` from Svelte context".
 */
import { getContext, setContext } from 'svelte';

import { HttpClient } from '@lostgradient/weft/client';

import type { WeftConsoleRuntimeConfig } from './config.ts';

const CLIENT_CONTEXT_KEY = Symbol('weft-console-client');

/**
 * `@lostgradient/weft/client`'s `HttpClient` constructor unconditionally
 * reads `Bun.env['WEFT_PROFILE']` while resolving its connection (no
 * `HttpClientOptions` field lets a caller skip this), which throws
 * `ReferenceError: Bun is not defined` in any real browser — confirmed via a
 * live in-browser repro (built with Vite, loaded in Chromium). Filed
 * upstream: https://github.com/stevekinney/weft/issues/713. This shim is the
 * console's interim workaround, not a fork of weft's code: it supplies the
 * one property (`Bun.env`) the resolver reads before any explicit
 * `baseUrl`/`token` this module always passes takes effect, so every lookup
 * resolves to `undefined` (the same outcome as a real, empty environment)
 * instead of crashing. Never overwrites a real `Bun` global (`??=`), so this
 * is a no-op under Bun (`bun test`, `bun run dev:server`).
 *
 * `as unknown as` is deliberate here, not a shortcut: `@types/bun` declares
 * the ambient `Bun` global as the full Bun runtime namespace, which this
 * shim does not and should not attempt to satisfy — it only needs to survive
 * the property reads weft's resolver performs.
 */
interface BunEnvironmentShim {
  env: Record<string, string | undefined>;
}

function ensureBunEnvironmentShim(): void {
  const target = globalThis as unknown as { Bun?: BunEnvironmentShim };
  target.Bun ??= { env: {} };
}

function isAbsoluteUrl(value: string): boolean {
  return URL.canParse(value);
}

/**
 * Resolves `config.baseUrl` to the absolute URL `HttpClient` requires.
 * `HttpClient` has no "relative"/same-origin mode of its own — its connection
 * resolver always does `new URL(server)`, which throws on anything but a
 * complete absolute URL — so the two documented non-absolute forms are
 * resolved against `sameOriginBaseUrl` here: the empty string (plan §3.3:
 * "same origin") and a root-relative path prefix such as `/weft` (plan
 * §3.3's Service Worker mode). An already-absolute `baseUrl` is returned
 * unchanged without ever touching `sameOriginBaseUrl` — a deliberate short
 * circuit, not just an optimization: `sameOriginBaseUrl` defaults to
 * `window.location.origin`, which callers should be able to trust is never
 * evaluated as a URL when it isn't needed (e.g. a non-browser embedding
 * where `window.location` is a stub). Passing `''`/`'/weft'` straight to
 * `HttpClient` would instead fall through its own
 * `WEFT_ADDR`/profile/`http://localhost:7233` resolution chain, or throw,
 * instead of hitting the server this bundle was actually served from.
 */
function resolveBaseUrl(baseUrl: string, sameOriginBaseUrl: string): string {
  if (isAbsoluteUrl(baseUrl)) return baseUrl;
  return new URL(baseUrl, sameOriginBaseUrl).toString();
}

/**
 * Constructs the app's single `HttpClient` from a resolved runtime config.
 *
 * `sameOriginBaseUrl` backs the empty-`baseUrl` ("same origin", plan §3.3)
 * case and defaults to the real `window.location.origin` — overridable so
 * tests don't depend on the ambient `window.location` (which under a bare
 * `bun test`/happy-dom document, with no navigation, is the opaque-origin
 * string `"null"`, not a usable URL).
 */
export function createClient(
  config: WeftConsoleRuntimeConfig,
  sameOriginBaseUrl: string = window.location.origin,
): HttpClient {
  ensureBunEnvironmentShim();

  // `HttpClientOptions.token`/`.headers` are `string | undefined` /
  // `Record<string, string> | undefined` WITHOUT `undefined` in their
  // declared types, so under `exactOptionalPropertyTypes` each key must be
  // omitted entirely rather than set to `undefined`.
  return new HttpClient({
    baseUrl: resolveBaseUrl(config.baseUrl, sameOriginBaseUrl),
    ...(config.token !== undefined ? { token: config.token } : {}),
    ...(config.headers !== undefined ? { headers: config.headers } : {}),
    eventTransport: config.eventTransport ?? 'auto',
  });
}

/**
 * Rebuilds the client with an operator-entered API key layered onto the base
 * runtime config (plan §4, §6 — the `reject`-mode API-key entry flow). The
 * key lives only in the returned `HttpClient`'s in-memory `Authorization`
 * header; this function never writes it anywhere persistent (no
 * `localStorage`, no cookies).
 */
export function setApiKey(config: WeftConsoleRuntimeConfig, apiKey: string): HttpClient {
  return createClient({ ...config, token: apiKey });
}

/** Provides the app's `HttpClient` to the component tree via Svelte context. */
export function provideClient(client: HttpClient): void {
  setContext(CLIENT_CONTEXT_KEY, client);
}

/**
 * Reads the app's `HttpClient` from Svelte context. Throws when called
 * outside a component tree rooted below a `provideClient()` call — every
 * route component renders under the shell, which provides it at boot.
 */
export function getClient(): HttpClient {
  const client = getContext<HttpClient | undefined>(CLIENT_CONTEXT_KEY);
  if (!client) {
    throw new Error(
      'weft-console: getClient() called with no client in context — provideClient() must run in an ancestor component.',
    );
  }
  return client;
}
