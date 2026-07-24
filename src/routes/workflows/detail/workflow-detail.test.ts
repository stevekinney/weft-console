import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DetachedWindowAPI } from 'happy-dom';

import { QueryClient } from '@tanstack/svelte-query';
import { render } from '@testing-library/svelte';

import { router } from '../../../lib/router.svelte.ts';
import type { Principal } from '../../../lib/scopes.svelte.ts';
import { realClient, ScriptedFetch } from '../list/workflow-test-support.test-support.ts';
import WorkflowDetailHarness from './workflow-detail.test-harness.svelte';

const GRANTED_PRINCIPAL: Principal = {
  scopes: ['workflows:read'],
  unauthenticatedAccess: null,
};

function resetLocation(path: string): void {
  (window as unknown as { happyDOM: DetachedWindowAPI }).happyDOM.setURL('http://localhost/');
  router.navigate(path, { replace: true });
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

let fetchScript: ScriptedFetch;

beforeEach(() => {
  fetchScript = new ScriptedFetch();
  // `WorkflowDetail` subscribes to the shared fleet feed unconditionally on
  // mount (module doc: "Fleet liveness" / `WorkflowLiveObservations`) — the
  // stream must stay open (never a finite/closed response) or
  // `FleetEventSource` reconnects in a loop (`routeSseStream` module doc).
  fetchScript.routeSseStream('/v1/events/sse');
});

afterEach(() => {
  fetchScript.restore();
});

describe('WorkflowDetail — not-found state', () => {
  test('a missing workflow id renders a named next step, not bare text', async () => {
    const bogusId = '00000000-0000-0000-0000-000000000000';
    // `HttpClient.get()` resolves a 404 GET to `null` rather than throwing
    // (weft's `request()` — see `workflow-detail.svelte`'s `notFound` derivation).
    fetchScript.routeUrlStatus(`/workflows/${bogusId}`, 404);
    resetLocation(`/workflows/${bogusId}`);

    const { findByText, queryByText } = render(WorkflowDetailHarness, {
      props: { client: realClient(), principal: GRANTED_PRINCIPAL, queryClient: newQueryClient() },
    });

    expect(await findByText('No workflow found')).not.toBeNull();
    expect(queryByText(`No workflow found with id ${bogusId}.`)).toBeNull();

    const backLink = await findByText('Back to workflows');
    expect(backLink.closest('a')?.getAttribute('href')).toBe(router.href('/workflows'));
  });
});
