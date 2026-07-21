import { describe, expect, test } from 'bun:test';

import DrainDialog from './drain-dialog.svelte';

describe('DrainDialog', () => {
  test('worker target: shows the worker id and calls onDrain with a trimmed reason', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const drained: (string | undefined)[] = [];
    const { getByText, getByLabelText, getByRole } = render(DrainDialog, {
      props: {
        open: true,
        target: { kind: 'worker', id: 'wkr_1' },
        submitting: false,
        onDrain: (reason) => drained.push(reason),
        onCancel: () => {},
      },
    });

    expect(getByText('wkr_1')).not.toBeNull();

    await fireEvent.input(getByLabelText('Reason'), { target: { value: '  rolling deploy  ' } });
    await fireEvent.click(getByRole('button', { name: 'Drain worker' }));

    expect(drained).toEqual(['rolling deploy']);
  });

  test('an empty/whitespace-only reason is passed as undefined', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const drained: (string | undefined)[] = [];
    const { getByRole } = render(DrainDialog, {
      props: {
        open: true,
        target: { kind: 'worker', id: 'wkr_1' },
        submitting: false,
        onDrain: (reason) => drained.push(reason),
        onCancel: () => {},
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Drain worker' }));
    expect(drained).toEqual([undefined]);
  });

  test('deployment target: shows the deployment name and the deployment-specific title', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText, getByRole } = render(DrainDialog, {
      props: {
        open: true,
        target: { kind: 'deployment', name: 'api-prod' },
        submitting: false,
        onDrain: () => {},
        onCancel: () => {},
      },
    });

    expect(getByText('api-prod')).not.toBeNull();
    expect(getByRole('button', { name: 'Drain deployment' })).not.toBeNull();
  });

  test('Cancel calls onCancel', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let cancelled = false;
    const { getByRole } = render(DrainDialog, {
      props: {
        open: true,
        target: { kind: 'worker', id: 'wkr_1' },
        submitting: false,
        onDrain: () => {},
        onCancel: () => (cancelled = true),
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Cancel' }));
    expect(cancelled).toBe(true);
  });
});
