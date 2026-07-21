import { describe, expect, test } from 'bun:test';

import BulkSelectionBar from './bulk-selection-bar.svelte';

describe('BulkSelectionBar', () => {
  test('renders nothing when nothing is selected', async () => {
    const { render } = await import('@testing-library/svelte');
    const { container } = render(BulkSelectionBar, {
      props: {
        selectedCount: 0,
        totalMatchingFilter: 0,
        onDeselect: () => {},
        actionsDisabledReason: 'Bulk operations ship in a later phase',
      },
    });

    expect(container.querySelector('.weft-bulk-bar')).toBeNull();
  });

  test('shows the selection count', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(BulkSelectionBar, {
      props: {
        selectedCount: 3,
        totalMatchingFilter: 47,
        onDeselect: () => {},
        actionsDisabledReason: 'Bulk operations ship in a later phase',
      },
    });

    expect(getByText('3 selected')).not.toBeNull();
  });

  test('every bulk action button is disabled', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getAllByRole } = render(BulkSelectionBar, {
      props: {
        selectedCount: 3,
        totalMatchingFilter: 47,
        onDeselect: () => {},
        actionsDisabledReason: 'Bulk operations ship in a later phase',
      },
    });

    // Reads `.disabled` directly rather than jest-dom's `toBeDisabled()` —
    // this project doesn't import the `bun:test` `Matchers` type
    // augmentation (`tests/setup.ts` extends `expect` at runtime only), so
    // `toBeDisabled()` doesn't typecheck even though it works at runtime
    // (see `src/app/auth/api-key-entry.test.ts`'s identical note).
    const buttons = getAllByRole('button').filter((button) =>
      ['Cancel', 'Signal', 'Retry failed', 'Mutate tags'].some((label) =>
        button.textContent?.includes(label),
      ),
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(4);
    for (const button of buttons) expect(button.disabled).toBe(true);
  });

  test('Deselect calls onDeselect', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let deselected = false;
    const { getByRole } = render(BulkSelectionBar, {
      props: {
        selectedCount: 3,
        totalMatchingFilter: 47,
        onDeselect: () => {
          deselected = true;
        },
        actionsDisabledReason: 'Bulk operations ship in a later phase',
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Deselect' }));
    expect(deselected).toBe(true);
  });

  test('shows the "select all matching" banner unless already selected-all', async () => {
    const { render } = await import('@testing-library/svelte');
    const first = render(BulkSelectionBar, {
      props: {
        selectedCount: 3,
        totalMatchingFilter: 47,
        onDeselect: () => {},
        actionsDisabledReason: 'x',
      },
    });
    expect(first.getByText(/Select all 47 matching the filter/)).not.toBeNull();
    first.unmount();

    const second = render(BulkSelectionBar, {
      props: {
        selectedCount: 47,
        totalMatchingFilter: 47,
        selectedAllMatching: true,
        onDeselect: () => {},
        actionsDisabledReason: 'x',
      },
    });
    expect(second.queryByText(/Select all 47 matching the filter/)).toBeNull();
  });
});
