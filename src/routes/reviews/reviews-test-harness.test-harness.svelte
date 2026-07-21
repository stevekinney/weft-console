<script lang="ts">
  /**
   * Test-only harness mounting the real Reviews route (`./index.svelte`)
   * under the Svelte context it needs at runtime (`HttpClient` via
   * `provideClient()`, a `PrincipalStore`, and a `QueryClientProvider`) —
   * the same shape `src/app/shell/shell.svelte` provides, without booting
   * the whole app. Mirrors the hard-coded-child pattern established by
   * `src/lib/provide-client-harness.test-harness.svelte` (a harness renders
   * ONE fixed subject, not an arbitrary snippet — snippets aren't
   * constructible from a plain `.test.ts` file). Never imported by
   * production code.
   */
  import { untrack } from 'svelte';

  import type { HttpClient } from '@lostgradient/weft/client';

  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';

  import { provideClient } from '../../lib/client.ts';
  import { providePrincipalStore, type AuthorizationScope } from '../../lib/scopes.svelte.ts';
  import ReviewsRoute from './index.svelte';

  interface ReviewsTestHarnessProps {
    client: HttpClient;
    scopes?: readonly AuthorizationScope[];
  }

  let { client, scopes = ['reviews:read', 'events:read'] }: ReviewsTestHarnessProps = $props();

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  provideClient(untrack(() => client));
  const principalStore = providePrincipalStore();
  principalStore.setPrincipal({ scopes: untrack(() => scopes), unauthenticatedAccess: null });
</script>

<QueryClientProvider client={queryClient}>
  <ReviewsRoute />
</QueryClientProvider>
