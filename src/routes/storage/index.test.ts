/**
 * Component tests for the Storage route (plan §9.6, Appendix B "denied
 * lock-states"): the `storage:admin` scope gate.
 */
import type { HttpClient } from '@lostgradient/weft/client';
import { afterEach, describe, expect, test } from 'bun:test';

import { stubStorageFetch } from './storage-fetch-stub.test-support.ts';
import StorageRouteHarness from './storage-route-test-harness.test-harness.svelte';

function fakeClient(): HttpClient {
  return { baseUrl: 'http://localhost:7233', headers: {} } as unknown as HttpClient;
}

let activeStub: { restore: () => void } | undefined;

afterEach(() => {
  activeStub?.restore();
  activeStub = undefined;
});

describe('Storage route', () => {
  test('shows a lock state naming the required scope when storage:admin is not granted', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText, queryByRole } = render(StorageRouteHarness, {
      props: { client: fakeClient(), scopes: [] },
    });

    expect(getByText('Storage access requires storage:admin')).not.toBeNull();
    expect(getByText('Requires storage:admin')).not.toBeNull();
    // The KV browser tabs never mount when the scope is missing.
    expect(queryByRole('tablist')).toBeNull();
  });

  test('renders the KV browser / Capabilities tabs when storage:admin is granted', async () => {
    activeStub = stubStorageFetch(
      () => new Response(JSON.stringify({ applied: true }), { status: 200 }),
    );

    const { render } = await import('@testing-library/svelte');
    const { getByText, queryByText } = render(StorageRouteHarness, {
      props: { client: fakeClient() },
    });

    expect(getByText('KV browser')).not.toBeNull();
    expect(getByText('Capabilities')).not.toBeNull();
    expect(queryByText('Storage access requires storage:admin')).toBeNull();
  });

  test('shows the reserved-prefix awareness banner when unlocked', async () => {
    activeStub = stubStorageFetch(
      () => new Response(JSON.stringify({ applied: true }), { status: 200 }),
    );

    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(StorageRouteHarness, { props: { client: fakeClient() } });

    expect(getByText(/used internally by the/)).not.toBeNull();
  });
});
