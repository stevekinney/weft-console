/**
 * Component tests for `<CriticalAlertsBand>` (plan §9.1, this track's
 * brief). Covers rendered chips, the both-scopes-denied lock state, and the
 * 403-degrades-the-principal path (plan §6). Uses a real `HttpClient`
 * scripted at the `fetch` layer — see `./dashboard-test-support.
 * test-support.ts`'s module doc for why.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import CriticalAlertsBandHarness from './critical-alerts-band-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './dashboard-test-support.test-support.ts';

async function waitForCondition(): Promise<typeof import('@testing-library/svelte').waitFor> {
  const { waitFor } = await import('@testing-library/svelte');
  return waitFor;
}

/**
 * This band drives two independent, real `HttpClient` round trips
 * (`weft.tasks.diagnostics` over JSON-RPC + `listReviews` over REST) through
 * actual `fetch`/`JSON.parse` and TanStack Query's observer scheduling —
 * verified by direct tracing that both settle correctly, just consistently
 * past `@testing-library/dom`'s 1000ms `waitFor` default in this
 * environment. A longer window here is sized to real multi-round-trip
 * resolution time, not a hang being papered over.
 */
const WAIT_FOR_TWO_QUERIES = { timeout: 3_000 };

const EMPTY_DIAGNOSTICS_SUMMARY = {
  stuckQueued: 0,
  staleInflight: 0,
  retryStorms: 0,
  allWorkersAtCapacity: 0,
  deadLettered: 0,
};

let scripted: ScriptedFetch | undefined;

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

describe('CriticalAlertsBand', () => {
  test('renders nothing when diagnostics are clean and no reviews are near timeout', async () => {
    const { render } = await import('@testing-library/svelte');
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.tasks.diagnostics', {
      items: [],
      summary: EMPTY_DIAGNOSTICS_SUMMARY,
      limit: 50,
    });
    scripted.routeUrl('/reviews', { items: [] });
    const client = realClient();

    // "Loading alerts" is the skeleton's `aria-label`, never rendered text —
    // `queryByText` never matches it (it only searches text nodes), so a
    // wait keyed on `queryByText` resolves on its very first, always-true
    // check instead of actually waiting for the skeleton to unmount.
    // `queryByLabelText` is the matcher built for `aria-label`.
    const { container, queryByLabelText } = render(CriticalAlertsBandHarness, {
      props: { client },
    });

    const waitFor = await waitForCondition();
    await waitFor(
      () => expect(queryByLabelText('Loading alerts')).toBeNull(),
      WAIT_FOR_TWO_QUERIES,
    );
    expect(container.textContent).toBe('');
  });

  test('renders a diagnostic chip that deep-links to the workers queue view', async () => {
    const { render } = await import('@testing-library/svelte');
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.tasks.diagnostics', {
      items: [],
      summary: { ...EMPTY_DIAGNOSTICS_SUMMARY, deadLettered: 3 },
      limit: 50,
    });
    scripted.routeUrl('/reviews', { items: [] });
    const client = realClient();

    const { getByText } = render(CriticalAlertsBandHarness, { props: { client } });

    const waitFor = await waitForCondition();
    await waitFor(
      () => expect(getByText('3 dead-lettered tasks')).not.toBeNull(),
      WAIT_FOR_TWO_QUERIES,
    );
    const link = getByText('3 dead-lettered tasks').closest('a');
    expect(link?.getAttribute('href')).toBe('/workers?diagnostic=deadLettered');
  });

  test('renders a reviews-near-timeout chip that deep-links to /reviews', async () => {
    const { render } = await import('@testing-library/svelte');
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethod('weft.tasks.diagnostics', {
      items: [],
      summary: EMPTY_DIAGNOSTICS_SUMMARY,
      limit: 50,
    });
    const now = Date.now();
    scripted.routeUrl('/reviews', {
      items: [
        {
          status: 'pending',
          reviewId: 'review-1',
          workflowId: 'wf-1',
          artifact: {},
          reviewType: 'content',
          reviewers: ['alice@example.com'],
          allowPartial: false,
          createdAt: now - 950_000,
          timeout: 1_000_000,
        },
      ],
    });
    const client = realClient();

    const { getByText } = render(CriticalAlertsBandHarness, { props: { client } });

    const waitFor = await waitForCondition();
    await waitFor(
      () => expect(getByText('1 review near timeout')).not.toBeNull(),
      WAIT_FOR_TWO_QUERIES,
    );
    const link = getByText('1 review near timeout').closest('a');
    expect(link?.getAttribute('href')).toBe('/reviews');
  });

  test('shows a lock notice instead of chips when both scopes are denied', async () => {
    const { render } = await import('@testing-library/svelte');
    scripted = new ScriptedFetch();
    const client = realClient();

    const { getByText } = render(CriticalAlertsBandHarness, {
      props: { client, scopes: [] },
    });

    const waitFor = await waitForCondition();
    await waitFor(() =>
      expect(
        getByText('Requires system:read, reviews:read to see critical alerts here.'),
      ).not.toBeNull(),
    );
  });

  test('a 403 from diagnostics degrades to a partial lock note while reviews chips still render', async () => {
    const { render } = await import('@testing-library/svelte');
    scripted = new ScriptedFetch();
    scripted.routeJsonRpcMethodForbidden('weft.tasks.diagnostics');
    const now = Date.now();
    scripted.routeUrl('/reviews', {
      items: [
        {
          status: 'pending',
          reviewId: 'review-1',
          workflowId: 'wf-1',
          artifact: {},
          reviewType: 'content',
          reviewers: ['alice@example.com'],
          allowPartial: false,
          createdAt: now - 950_000,
          timeout: 1_000_000,
        },
      ],
    });
    const client = realClient();

    const { getByText } = render(CriticalAlertsBandHarness, { props: { client } });

    const waitFor = await waitForCondition();
    await waitFor(
      () => expect(getByText('1 review near timeout')).not.toBeNull(),
      WAIT_FOR_TWO_QUERIES,
    );
    expect(getByText('Requires system:read')).not.toBeNull();
  });
});
