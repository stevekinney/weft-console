<script lang="ts">
  /**
   * Test-only harness for Track E2 (System) component tests: wraps a given
   * component with every context provider a System tab might need —
   * `provideClient()` (`src/lib/client.ts`), `QueryClientProvider`
   * (`@tanstack/svelte-query`), and `providePrincipalStore()`
   * (`src/lib/scopes.svelte.ts`) — mirroring how `src/app/shell/shell.svelte`
   * and `src/app/app.svelte` wire them in the real app. One generic harness
   * (rather than one per tab) since every tab under test needs some subset
   * of this same trio.
   *
   * `providePrincipalStore()`'s context key is a private module-scope
   * `Symbol` (by design — `scopes.svelte.ts`'s module doc), so this harness
   * can't inject an already-built `PrincipalStore`; it creates one via the
   * real provider function and immediately seeds it with `principalScopes`
   * (defaulting to every scope granted) before the wrapped component's own
   * init runs, so `getPrincipalStore()` inside it always sees a resolved
   * principal on first render — never the `null` "still resolving" state.
   */
  import type { HttpClient } from '@lostgradient/weft/client';
  import { QueryClientProvider, type QueryClient } from '@tanstack/svelte-query';
  import { untrack, type Component } from 'svelte';

  import { provideClient } from '../../lib/client.ts';
  import {
    AUTHORIZATION_SCOPES,
    providePrincipalStore,
    type AuthorizationScope,
  } from '../../lib/scopes.svelte.ts';

  interface Props {
    client: HttpClient;
    queryClient: QueryClient;
    component: Component;
    principalScopes?: readonly AuthorizationScope[];
  }

  let { client, queryClient, component: RouteComponent, principalScopes }: Props = $props();

  // Read once at this harness's own initialization — same `untrack()`
  // convention `provide-client-harness.test-harness.svelte` (T1.1) uses for
  // the identical "no reactive dependency past this point" reason.
  provideClient(untrack(() => client));

  const principalStore = providePrincipalStore();
  principalStore.setPrincipal({
    scopes: untrack(() => principalScopes) ?? AUTHORIZATION_SCOPES,
    unauthenticatedAccess: null,
  });
</script>

<QueryClientProvider client={queryClient}>
  <RouteComponent />
</QueryClientProvider>
