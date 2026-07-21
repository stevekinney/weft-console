/**
 * Component tests for the System route shell (`index.svelte`; plan §9.7).
 * Covers URL-owned tab state: default tab, switching tabs updates `?tab=`,
 * and a deep link into a non-default tab renders that tab on load.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { DetachedWindowAPI } from 'happy-dom';

import { createQueryClient } from '../../lib/query.ts';
import { router } from '../../lib/router.svelte.ts';
import SystemRoute from './index.svelte';
import SystemRouteTestHarness from './system-route-test-harness.test-harness.svelte';
import { realClient, ScriptedFetch } from './system-test-support.test-support.ts';

let scripted: ScriptedFetch | undefined;

function happyDomAPI(): DetachedWindowAPI {
  return (window as unknown as { happyDOM: DetachedWindowAPI }).happyDOM;
}

/**
 * happy-dom's default `window.location` is `about:blank` (no origin), and
 * `history.pushState`/`replaceState` are silent no-ops from a non-hierarchical
 * origin — same convention `router.svelte.test.ts` (T1.3) establishes: give
 * the window a real origin before every test touches the reactive `router`
 * singleton.
 */
function resetLocation(path = '/system'): void {
  happyDomAPI().setURL('http://localhost/');
  router.navigate(path, { replace: true });
}

beforeEach(() => {
  resetLocation();
});

afterEach(() => {
  scripted?.restore();
  scripted = undefined;
});

async function renderSystemRoute() {
  scripted = new ScriptedFetch();
  scripted.routeJsonRpcMethod('weft.system.registry', {
    registryVersion: 1,
    workflows: {},
    activities: {},
  });

  const { render } = await import('@testing-library/svelte');
  return render(SystemRouteTestHarness, {
    props: { client: realClient(), queryClient: createQueryClient(), component: SystemRoute },
  });
}

describe('System route', () => {
  test('defaults to the Registry tab when no ?tab= is present', async () => {
    const { findByRole } = await renderSystemRoute();
    const registryTrigger = await findByRole('tab', { name: 'Registry' });
    expect(registryTrigger.getAttribute('aria-selected')).toBe('true');
  });

  test('clicking a tab updates the URL and renders that tab', async () => {
    const { findByRole } = await renderSystemRoute();
    const { fireEvent } = await import('@testing-library/svelte');

    await fireEvent.click(await findByRole('tab', { name: 'Scopes' }));

    expect(router.search.get('tab')).toBe('scopes');
    const scopesTrigger = await findByRole('tab', { name: 'Scopes' });
    expect(scopesTrigger.getAttribute('aria-selected')).toBe('true');
  });

  test('deep-linking to ?tab=alerts renders the Alerts tab on load', async () => {
    resetLocation('/system?tab=alerts');
    const { findByRole } = await renderSystemRoute();
    const alertsTrigger = await findByRole('tab', { name: 'Alerts' });
    expect(alertsTrigger.getAttribute('aria-selected')).toBe('true');
  });

  test('an unrecognized ?tab= value falls back to Registry rather than erroring', async () => {
    resetLocation('/system?tab=nonsense');
    const { findByRole } = await renderSystemRoute();
    const registryTrigger = await findByRole('tab', { name: 'Registry' });
    expect(registryTrigger.getAttribute('aria-selected')).toBe('true');
  });
});
