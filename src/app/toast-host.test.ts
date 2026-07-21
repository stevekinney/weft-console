/**
 * Component tests for `<ToastHost>` and its module-level `showToast`/
 * `showFault` API (plan §10.4, §11.2, T1.5). Run with `--conditions browser
 * --conditions svelte` (repo-wide `bun run test`) — see `tests/setup.ts`.
 *
 * `toastApi` is intentionally app-wide module state (module doc in
 * `toast-host.svelte`), not per-render-call state — the global
 * `afterEach(cleanup)` registered in `tests/setup.ts` unmounts every
 * rendered `<ToastHost>` between tests, which runs this component's
 * attachment cleanup and resets that module state back to `undefined`, so
 * tests stay isolated from each other without doing that by hand here.
 */
import { describe, expect, spyOn, test } from 'bun:test';

import { UNKNOWN_FAULT_TREATMENT } from '../lib/faults.ts';
import ToastHost, { showFault, showToast } from './toast-host.svelte';

describe('showToast — before <ToastHost> has mounted', () => {
  test('no-ops and logs a console.error rather than throwing', () => {
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(showToast('too early')).toBeUndefined();
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[0]).toContain('showToast() called before');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('showToast — after <ToastHost> has mounted', () => {
  test('renders the message into the DOM', async () => {
    const { render } = await import('@testing-library/svelte');
    const { findByText } = render(ToastHost);

    showToast('Saved your changes.');

    expect(await findByText('Saved your changes.')).not.toBeNull();
  });

  test('returns the toast id Cinder assigned', async () => {
    const { render } = await import('@testing-library/svelte');
    render(ToastHost);

    const id = showToast('has an id');

    expect(typeof id).toBe('string');
    expect(id?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('showFault', () => {
  test('renders "<title>: <message>" with a warning variant for a lower-stakes treatment (not-found)', async () => {
    const { render } = await import('@testing-library/svelte');
    const { findByText } = render(ToastHost);

    showFault({ kind: 'not-found', message: 'workflow wf-1 not found' });

    const toastText = await findByText('Not found: workflow wf-1 not found');
    expect(toastText.closest('[data-cinder-variant]')?.getAttribute('data-cinder-variant')).toBe(
      'warning',
    );
  });

  test('renders a danger variant for internal', async () => {
    const { render } = await import('@testing-library/svelte');
    const { findByText } = render(ToastHost);

    showFault(UNKNOWN_FAULT_TREATMENT);

    const toastText = await findByText(`Something went wrong: ${UNKNOWN_FAULT_TREATMENT.message}`);
    expect(toastText.closest('[data-cinder-variant]')?.getAttribute('data-cinder-variant')).toBe(
      'danger',
    );
  });

  test('renders a danger variant for invalid', async () => {
    const { render } = await import('@testing-library/svelte');
    const { findByText } = render(ToastHost);

    showFault({ kind: 'invalid', message: 'name is required', fieldErrors: [] });

    const toastText = await findByText('Invalid input: name is required');
    expect(toastText.closest('[data-cinder-variant]')?.getAttribute('data-cinder-variant')).toBe(
      'danger',
    );
  });
});
