import { describe, expect, test } from 'bun:test';

import type { AttributeFilter } from '../../../lib/attribute-filters.ts';
import QueryBuilder from './query-builder.svelte';

describe('QueryBuilder', () => {
  test('renders one row per seeded attribute filter, plus operator/value text', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByDisplayValue } = render(QueryBuilder, {
      props: {
        attributes: [{ key: 'customerTier', value: 'gold' }] satisfies AttributeFilter[],
        onAttributesChange: () => {},
        knownAttributeKeys: ['customerTier', 'amount'],
      },
    });

    expect(getByDisplayValue('customerTier')).not.toBeNull();
    expect(getByDisplayValue('gold')).not.toBeNull();
  });

  test('renders one blank row when there are no seeded attributes', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByLabelText } = render(QueryBuilder, {
      props: { attributes: [], onAttributesChange: () => {}, knownAttributeKeys: [] },
    });

    expect(getByLabelText('Field for condition 1')).not.toBeNull();
  });

  test('typing a value calls onAttributesChange with the updated filter', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let latest: AttributeFilter[] | undefined;
    const { getByLabelText } = render(QueryBuilder, {
      props: {
        attributes: [{ key: 'customerTier', value: 'gold' }] satisfies AttributeFilter[],
        onAttributesChange: (next) => {
          latest = next;
        },
        knownAttributeKeys: [],
      },
    });

    const valueInput = getByLabelText('Value for condition 1') as HTMLInputElement;
    await fireEvent.input(valueInput, { target: { value: 'silver' } });

    expect(latest).toEqual([{ key: 'customerTier', value: 'silver' }]);
  });

  test('"Add condition" appends a blank row', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const { getByRole, getByLabelText } = render(QueryBuilder, {
      props: { attributes: [], onAttributesChange: () => {}, knownAttributeKeys: [] },
    });

    await fireEvent.click(getByRole('button', { name: 'Add condition' }));

    expect(getByLabelText('Field for condition 1')).not.toBeNull();
    expect(getByLabelText('Field for condition 2')).not.toBeNull();
  });

  test('removing the only row leaves one blank row rather than zero', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let latest: AttributeFilter[] | undefined;
    const { getByRole, getByLabelText } = render(QueryBuilder, {
      props: {
        attributes: [{ key: 'customerTier', value: 'gold' }] satisfies AttributeFilter[],
        onAttributesChange: (next) => {
          latest = next;
        },
        knownAttributeKeys: [],
      },
    });

    await fireEvent.click(getByRole('button', { name: 'Remove condition 1' }));

    expect(latest).toEqual([]);
    expect(getByLabelText('Field for condition 1')).not.toBeNull();
  });

  test('switching to Raw mode shows the JSON preview', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    const { getByRole, getByText } = render(QueryBuilder, {
      props: {
        attributes: [{ key: 'customerTier', value: 'gold' }] satisfies AttributeFilter[],
        onAttributesChange: () => {},
        knownAttributeKeys: [],
      },
    });

    await fireEvent.click(getByRole('radio', { name: 'Raw' }));

    expect(getByText(/customerTier/)).not.toBeNull();
  });
});
