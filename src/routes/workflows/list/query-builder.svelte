<script lang="ts">
  /**
   * Search-attribute query builder UI (plan §9.2 T2.2, §10.3). Wraps the
   * pure row ↔ `AttributeFilter[]` logic in `query-builder.ts`. See that
   * module's doc for why this is an app-local composition
   * (`Combobox`/`Select`/`Input` rows) rather than Cinder's
   * `InvocationRuleBuilder` (C4) — re-evaluated against Cinder 0.17.0's
   * `mode="flat-conditions"` (cinder#854), still blocked on the field
   * selector's lack of free-text entry (filed as cinder#865).
   */
  import { Plus, X } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import Combobox from '@lostgradient/cinder/combobox';
  import type { ComboboxOption } from '@lostgradient/cinder/combobox';
  import Input from '@lostgradient/cinder/input';
  import JsonViewer from '@lostgradient/cinder/json-viewer';
  import SegmentedControl, { Segment } from '@lostgradient/cinder/segmented-control';
  import Select from '@lostgradient/cinder/select';

  import type { AttributeFilter } from '../../../lib/attribute-filters.ts';
  import {
    attributeFiltersToQueryConditionRows,
    createEmptyQueryConditionRow,
    QUERY_CONDITION_OPERATORS,
    queryConditionRowsToAttributeFilters,
    queryConditionRowsToRawPreview,
    type QueryConditionRow,
  } from './query-builder.ts';

  interface QueryBuilderProps {
    attributes: readonly AttributeFilter[];
    onAttributesChange: (next: AttributeFilter[]) => void;
    /** Observed attribute names for the field typeahead (plan §10.3: "key typeahead from observed attributes + free text"). */
    knownAttributeKeys: readonly string[];
  }

  let { attributes, onAttributesChange, knownAttributeKeys }: QueryBuilderProps = $props();

  /**
   * Rows are the builder's own editing state, seeded once from `attributes`
   * and pushed back out via `onAttributesChange` on every edit —
   * `attributes` is deliberately NOT re-derived from rows on every
   * keystroke, so an in-progress blank row (no key/value typed yet) doesn't
   * flicker in and out of the URL/filter object. `untrack()` makes that
   * one-time read explicit instead of triggering Svelte's "state
   * referenced locally" warning (same pattern as `shell.svelte`'s
   * once-only prop capture).
   */
  let rows = $state<QueryConditionRow[]>(
    untrack(() =>
      attributes.length > 0
        ? attributeFiltersToQueryConditionRows(attributes)
        : [createEmptyQueryConditionRow()],
    ),
  );

  let mode = $state<'visual' | 'raw'>('visual');

  const fieldOptions = $derived(
    knownAttributeKeys.map((key): ComboboxOption => ({ value: key, label: key })),
  );
  const rawPreview = $derived(queryConditionRowsToRawPreview(rows));

  function commit(nextRows: QueryConditionRow[]): void {
    rows = nextRows;
    onAttributesChange(queryConditionRowsToAttributeFilters(nextRows));
  }

  function updateRow(id: string, patch: Partial<QueryConditionRow>): void {
    commit(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow(): void {
    commit([...rows, createEmptyQueryConditionRow()]);
  }

  function removeRow(id: string): void {
    const next = rows.filter((row) => row.id !== id);
    commit(next.length > 0 ? next : [createEmptyQueryConditionRow()]);
  }
</script>

<div class="weft-query-builder">
  <div class="weft-query-builder__mode-toggle">
    <SegmentedControl
      id="weft-query-builder-mode"
      label="View"
      hideLabel
      density="toolbar"
      value={mode}
      onchange={(value) => (mode = value)}
    >
      <Segment value="visual">Visual</Segment>
      <Segment value="raw">Raw</Segment>
    </SegmentedControl>
  </div>

  {#if mode === 'visual'}
    <div class="weft-query-builder__rows">
      {#each rows as row, index (row.id)}
        <div class="weft-query-builder__row">
          <Combobox
            id={`weft-query-builder-key-${row.id}`}
            label={`Field for condition ${index + 1}`}
            options={fieldOptions}
            placeholder="attribute name"
            value={row.key}
            bind:inputValue={() => row.key, (value) => updateRow(row.id, { key: value })}
          />
          <Select
            id={`weft-query-builder-operator-${row.id}`}
            aria-label={`Operator for condition ${index + 1}`}
            value={row.operator}
            options={QUERY_CONDITION_OPERATORS.map((operator) => ({
              value: operator,
              label: operator,
            }))}
            onchange={(event) =>
              updateRow(row.id, {
                operator: (event.currentTarget as HTMLSelectElement)
                  .value as QueryConditionRow['operator'],
              })}
          />
          <Input
            id={`weft-query-builder-value-${row.id}`}
            label={`Value for condition ${index + 1}`}
            hideLabel
            value={row.value}
            oninput={(event) =>
              updateRow(row.id, { value: (event.currentTarget as HTMLInputElement).value })}
          />
          <button
            type="button"
            class="weft-query-builder__remove"
            aria-label={`Remove condition ${index + 1}`}
            onclick={() => removeRow(row.id)}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
        {#if index < rows.length - 1}
          <div class="weft-query-builder__and">AND</div>
        {/if}
      {/each}
      <button type="button" class="weft-query-builder__add" onclick={addRow}>
        <Plus aria-hidden="true" size={13} />
        Add condition
      </button>
      <p class="weft-query-builder__hint">Operators: eq · gt · lt · gte · lte only. No OR/LIKE.</p>
    </div>
  {:else}
    <!-- This preview is always a handful of shallow conditions (plan §10.3:
         AND-only, no nested grouping), so it is fully expanded by default —
         `JsonViewer`'s own `initialDepth` default of 1 would otherwise hide
         every condition behind a click for what is meant to be a quick
         equivalence check against the visual rows above. -->
    <JsonViewer value={rawPreview} initialDepth={6} />
  {/if}
</div>
