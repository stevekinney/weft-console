<script lang="ts">
  /**
   * Test-only harness for the Workers route root (`index.svelte`): wraps it
   * with every context provider it needs — `provideClient()`
   * (`src/lib/client.ts`), `QueryClientProvider` (`@tanstack/svelte-query`),
   * and `providePrincipalStore()` (`src/lib/scopes.svelte.ts`) — mirroring
   * `src/routes/system/system-route-test-harness.test-harness.svelte`'s
   * identical shape for the same reason: `index.svelte` reads all three via
   * context, not props.
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
