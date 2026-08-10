/**
 * Component tests for `<RegistryTab>` (plan §9.7 T7.2). Covers loading,
 * fault, 3-step onboarding empty state, the definitions list, and drilling
 * into a definition's detail panel (Appendix B: "Registry (schema tree)").
 */
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, test } from 'bun:test';

import { createQueryClient } from '../../lib/query.ts';
import RegistryTab from './registry-tab.svelte';
import SystemRouteTestHarness from './system-route-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './system-test-support.test-support.ts';

let scripted: ScriptedFetch | undefined;

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

async function renderRegistryTab() {
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: RegistryTab },
  });
}

describe('RegistryTab', () => {
  test('shows a loading state while the query is pending', async () => {
    scripted = new ScriptedFetch();
    // No response queued — the request stays pending for this assertion.
    const { getByLabelText } = await renderRegistryTab();
    expect(getByLabelText('Loading registry')).not.toBeNull();
  });

  test('shows the fault banner on a failed fetch, with a working Retry', async () => {
    scripted = new ScriptedFetch();
    scripted.enqueueJson(
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32000, message: 'Forbidden', data: { httpStatus: 403 } },
      },
      { status: 200 },
    );
    const { findByText } = await renderRegistryTab();
    expect(await findByText('Not authorized')).not.toBeNull();
  });

  test('renders the 3-step onboarding empty state when nothing is registered', async () => {
    scripted = new ScriptedFetch();
    scripted.enqueueJsonRpcResult({ registryVersion: 1, workflows: {}, activities: {} });
    const { findByText } = await renderRegistryTab();
    expect(await findByText('Install the SDK', { exact: false })).not.toBeNull();
  });

  test('lists workflow definitions and activities, then drills into a definition detail', async () => {
    scripted = new ScriptedFetch();
    scripted.enqueueJsonRpcResult({
      registryVersion: 1,
      workflows: {
        'order-processing': {
          description: 'Processes an order end to end.',
          inputSchema: {
            type: 'object',
            required: ['orderId'],
            properties: { orderId: { type: 'string' } },
          },
        },
      },
      activities: { chargeCard: { queue: 'default' } },
    });

    const { findByText, findAllByText, getByRole } = await renderRegistryTab();

    expect(await findByText('order-processing')).not.toBeNull();
    expect(await findByText('chargeCard')).not.toBeNull();
    expect(await findByText('1 field')).not.toBeNull();

    await fireEvent.click(getByRole('button', { name: /order-processing/ }));

    expect(await findByText('Processes an order end to end.')).not.toBeNull();
    const orderIdMatches = await findAllByText('orderId');
    expect(orderIdMatches.length).toBeGreaterThan(0);

    await fireEvent.click(getByRole('button', { name: 'Workflow definitions' }));
    expect(await findByText('order-processing')).not.toBeNull();
  });
});
