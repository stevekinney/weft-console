/**
 * Principal + scope gating (plan §6, T1.2). Frozen after the Phase 1
 * Foundation gate — see PROJECT-BRIEF "Shared contracts".
 *
 * The 23 scopes below are flat (`workflows:admin` does NOT imply
 * `workflows:read`) and mirror weft's internal `AUTHORIZATION_SCOPES`
 * (`weft/src/server/authorization-scope.ts`), which is not currently a
 * public export of `@lostgradient/weft/server` — this literal union is the
 * console's own copy of that contract. Re-verify against
 * `documentation/reference/configuration.md` when bumping `@lostgradient/weft`.
 *
 * ## The missing principal-introspection operation (T1.2 finding)
 *
 * Plan §6 assumes a `weft.system.principal`-equivalent catalog operation.
 * Verified against `weft` v0.11.0 (`weft/src/server/operations/*.ts`,
 * 2026-07-20): no such operation exists — every `defineOperation({ name:
 * 'weft.…' })` in the catalog was enumerated and none introspects the
 * caller's identity or granted scopes. This is a known, already-tracked gap
 * (plan §14.1 item 4: "Confirm/expose a principal introspection operation
 * … T1.2 pins this") — this module is the pin. Re-check on every
 * `@lostgradient/weft` bump; replace `resolvePrincipal()`'s probe below with
 * a direct call the day one ships.
 *
 * ## The fallback this module implements instead
 *
 * `resolvePrincipal()` infers principal state from the HTTP status of a
 * cheap, always-available, side-effect-free probe call —
 * `client.list({ limit: 1 })` (`weft.workflows.list`, `access: 'public'`).
 * That probe can only observe the TRANSPORT-level authentication gate (401
 * when the server has `auth` configured and no valid credential was
 * supplied), not any operation's own scope check — `list` is public-access
 * precisely so it never produces a 403 on its own.
 *
 * Once the probe resolves, this module optimistically grants all 23 scopes
 * and *degrades* specific ones as the app observes real `403 Forbidden`
 * responses from scope-gated operations it actually calls (`denyScope()` /
 * `isForbidden()`). This is a reasonably safe default: verified against the
 * same operation catalog, the overwhelming majority of operations —
 * including every workflow/schedule/review mutation — declare
 * `access: { kind: 'public' }`. Only a small set (`weft.system.registry`,
 * `weft.system.metrics`, the storage operations, `weft.workers.*` /
 * `weft.worker.deployments.*`, and the fleet/workflow event & stream
 * subscriptions) declare `scoped`/`authenticated` access, so most gated UI
 * actions this store disables-with-reason will, in fact, be permitted by
 * the server even under an optimistic guess.
 *
 * `unauthenticatedAccess: 'warn'` vs `'allow'` are wire-indistinguishable
 * from the console: both mean the server has no `auth` configured at all
 * (`weft/src/server/serve-internals.ts` `assertAuthenticationPosture`
 * consults `unauthenticatedAccess` only at server boot, to decide whether
 * to refuse starting — it has no per-request effect once the process is
 * up). This module cannot tell them apart, so a successful, uncredentialed
 * probe always resolves to the more visible `'warn'` banner — the safer
 * default when the true value is unknown. `'reject'` is likewise never
 * observed directly: when `auth` IS configured, `unauthenticatedAccess` has
 * no runtime effect (`assertAuthenticationPosture` returns immediately when
 * `options.auth` is set) and an uncredentialed request 401s regardless of
 * that option's value — which this module treats identically to a rejected
 * probe (no principal; the API-key entry surface must run).
 *
 * The lossless fix — carrying the server's actual configured posture to the
 * client — belongs in `WeftConsoleRuntimeConfig` (`src/lib/config.ts`,
 * T1.1's owned file, out of scope here): an explicit hint would remove the
 * need to infer any of this from probe behavior at all.
 */
import { getContext, setContext } from 'svelte';

import { HttpClientError, type HttpClient } from '@lostgradient/weft/client';

export const AUTHORIZATION_SCOPES = [
  'workflows:read',
  'workflows:write',
  'workflows:admin',
  'schedules:read',
  'schedules:write',
  'signals:write',
  'updates:write',
  'queries:read',
  'reviews:read',
  'reviews:write',
  'attributes:read',
  'attributes:write',
  'tags:write',
  'streams:read',
  'events:read',
  'budget:read',
  'budget:write',
  'storage:read',
  'storage:write',
  'storage:admin',
  'workers:write',
  'system:read',
  'system:admin',
] as const;

export type AuthorizationScope = (typeof AUTHORIZATION_SCOPES)[number];

/** Startup policy mirrored from `UnauthenticatedAccessPolicy` (plan §6). */
export type UnauthenticatedAccessPolicy = 'warn' | 'allow' | 'reject';

export interface Principal {
  /**
   * Scopes currently believed granted. Starts as all 23 (optimistic — see
   * module doc) and only ever shrinks, via `denyScope()`, as real `403`s
   * are observed.
   */
  scopes: readonly AuthorizationScope[];
  /**
   * Set when the server ran without `auth` configured. `'warn'`/`'allow'`
   * both mean "granted by default" (indistinguishable on the wire — module
   * doc); `null` means this is a normally authenticated principal (an
   * accepted credential), which shows no banner.
   */
  unauthenticatedAccess: UnauthenticatedAccessPolicy | null;
}

/**
 * The auth-mode banner state a principal implies (plan §6, §10). `'none'`
 * means "authenticated normally, nothing to announce."
 */
export type BannerMode =
  'auth-required' | 'unauthenticated-warn' | 'unauthenticated-allow' | 'none';

const PRINCIPAL_CONTEXT_KEY = Symbol('weft-console-principal');

export class PrincipalStore {
  principal = $state<Principal | null>(null);

  hasScope(...required: readonly AuthorizationScope[]): boolean {
    const current = this.principal;
    if (!current) return false;
    return required.every((scope) => current.scopes.includes(scope));
  }

  /** Auth-mode banner state derived from the current principal (plan §6). */
  get bannerMode(): BannerMode {
    const current = this.principal;
    if (!current) return 'auth-required';
    if (current.unauthenticatedAccess === 'warn') return 'unauthenticated-warn';
    if (current.unauthenticatedAccess === 'allow') return 'unauthenticated-allow';
    return 'none';
  }

  /** Sets the resolved principal — a successful boot probe or API-key entry. */
  setPrincipal(principal: Principal): void {
    this.principal = principal;
  }

  /**
   * Clears the principal, returning the store to `bannerMode: 'auth-required'`.
   * Callers decide when this applies (e.g. a `401` on a live credential,
   * observed via `isUnauthorized()`) — this module never clears the
   * principal automatically (module doc: only `403`s degrade automatically).
   */
  clear(): void {
    this.principal = null;
  }

  /**
   * Revokes one or more scopes from the current principal after the server
   * has denied them with a real `403 Forbidden` (module doc). No-op when
   * there is no principal yet. Idempotent.
   */
  denyScope(...scopes: readonly AuthorizationScope[]): void {
    const current = this.principal;
    if (!current) return;
    this.principal = {
      ...current,
      scopes: current.scopes.filter((scope) => !scopes.includes(scope)),
    };
  }

  /** Runs `resolvePrincipal()` and applies its result (module doc). */
  async bootstrap(client: PrincipalProbeClient, options: ResolvePrincipalOptions): Promise<void> {
    this.principal = await resolvePrincipal(client, options);
  }
}

export function providePrincipalStore(): PrincipalStore {
  const store = new PrincipalStore();
  setContext(PRINCIPAL_CONTEXT_KEY, store);
  return store;
}

export function getPrincipalStore(): PrincipalStore {
  const store = getContext<PrincipalStore | undefined>(PRINCIPAL_CONTEXT_KEY);
  if (!store) {
    throw new Error(
      'weft-console: getPrincipalStore() called with no store in context — providePrincipalStore() must run in an ancestor component.',
    );
  }
  return store;
}

/** `true` for an `HttpClientError` carrying the given HTTP status. */
function isHttpStatus(error: unknown, status: number): boolean {
  return error instanceof HttpClientError && error.status === status;
}

/**
 * `true` when `error` is a `403 Forbidden` from a scope-gated operation.
 * Call sites that know which scope(s) an action required should follow this
 * with `principalStore.denyScope(...)` — the automatic-degrade half of the
 * fallback (module doc).
 */
export function isForbidden(error: unknown): boolean {
  return isHttpStatus(error, 403);
}

/**
 * `true` when `error` is a `401 Unauthorized` — no credential was accepted
 * by the transport-level authenticator. Exposed for call sites that want to
 * react to a live credential expiring (e.g. `principalStore.clear()`); this
 * module itself never reacts to `401` automatically (module doc).
 */
export function isUnauthorized(error: unknown): boolean {
  return isHttpStatus(error, 401);
}

/** The slice of `HttpClient` the bootstrap probe needs — see `resolvePrincipal()`. */
type PrincipalProbeClient = Pick<HttpClient, 'list'>;

export interface ResolvePrincipalOptions {
  /**
   * Whether `client` already carries a credential — an injected runtime-config
   * token, or an API key entered through the reject-mode entry surface.
   * `HttpClient` does not expose whether it holds one, and the probe's `200`
   * outcome means something different in each case (module doc): with a
   * credential it means "authenticated normally"; without one it means
   * "the server has no `auth` configured."
   */
  credentialed: boolean;
}

/**
 * Resolves the current principal via the probe-and-infer fallback (module
 * doc) — there is no principal-introspection catalog operation to call
 * directly (verified against weft v0.11.0).
 *
 * Returns `null` when the probe is rejected with `401` (no valid credential
 * accepted): with `options.credentialed: true` this means the supplied
 * credential was invalid/expired; with `false` it means the server requires
 * one and the API-key entry surface must run. Both read identically to the
 * caller — "no principal yet."
 *
 * Any other error (network failure, `500`, etc.) is not one of the auth
 * states this module owns and is rethrown for the caller's own fault
 * handling (plan §10.4).
 */
export async function resolvePrincipal(
  client: PrincipalProbeClient,
  options: ResolvePrincipalOptions,
): Promise<Principal | null> {
  try {
    await client.list({ limit: 1 });
  } catch (error) {
    if (isUnauthorized(error)) return null;
    throw error;
  }

  return {
    scopes: AUTHORIZATION_SCOPES,
    unauthenticatedAccess: options.credentialed ? null : 'warn',
  };
}

/** Tooltip text for a missing-scope disable-with-reason (plan §6, §10). */
export function scopeReason(...required: readonly AuthorizationScope[]): string {
  return `Requires ${required.join(', ')}`;
}

/**
 * Disable-with-tooltip convention (plan §6, §10): never hide a
 * capability, disable it and say why. Spread the result onto a button-like
 * component's `disabled`/`title` props.
 */
export interface ScopeGate {
  disabled: boolean;
  title: string | undefined;
}

export function scopeGate(
  store: PrincipalStore,
  required: readonly AuthorizationScope[],
): ScopeGate {
  const granted = store.hasScope(...required);
  return { disabled: !granted, title: granted ? undefined : scopeReason(...required) };
}
