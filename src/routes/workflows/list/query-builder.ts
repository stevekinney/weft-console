/**
 * Search-attribute query builder — pure logic (plan §9.2 T2.2, §10.3).
 *
 * **Why not `InvocationRuleBuilder` (C4), re-evaluated against Cinder
 * 0.17.0.** The original blocker — `mode="conditions"` (Cinder 0.16.1)
 * groups conditions under independent named "rules" with unconditional
 * label/move/remove chrome, which this console's flat AND-only grammar
 * (plan §10.3, `src/lib/filters.ts` + `attribute-filters.ts`) cannot
 * represent — was filed as cinder#847 and fixed by cinder#854's new
 * `mode="flat-conditions"` (a direct `conditions: InvocationRuleCondition[]`
 * array, no rule-group metadata at all). Re-evaluated against the installed
 * `invocation-rule-builder.types.ts`/`.svelte`, flat-conditions mode still
 * doesn't fit, for a *different*, narrower reason: its field selector is a
 * plain `<select>` populated from the `fieldOptions` prop
 * (`invocation-rule-builder.svelte:635-651`) with no way to type a key that
 * isn't already in that list. This console's grammar allows filtering on
 * ANY search-attribute key, including ones the console has never observed a
 * value for yet, which is exactly what `Combobox`'s free-text
 * `bind:inputValue` gives `query-builder.svelte` today ("key typeahead from
 * observed attributes + free text" per plan §10.3) — a `<select>` cannot
 * do that. Filed upstream as cinder#865. Until it lands, this ships as a
 * minimal app-local composition (`Combobox` + `Select` + `Input` rows,
 * matching `design/Weft Patterns.dc.html`'s query-builder markup exactly)
 * rather than cloning `InvocationRuleBuilder`'s row assembly.
 *
 * This module is the pure half: condition rows ↔ `AttributeFilter[]` (the
 * shape `src/lib/attribute-filters.ts` already serializes to/from the URL),
 * plus a read-only `{ and: [...] }` JSON projection matching the design's
 * "Raw toggle" panel (a preview, not an editable raw mode — the design mock
 * shows no JSON input for this builder, only a read-only equivalent).
 * `query-builder.svelte` is the thin UI wrapper.
 */
import type { AttributeFilter, AttributeScalar } from '../../../lib/attribute-filters.ts';

export type QueryConditionOperator = 'eq' | 'gt' | 'lt' | 'gte' | 'lte';

export const QUERY_CONDITION_OPERATORS: readonly QueryConditionOperator[] = [
  'eq',
  'gt',
  'lt',
  'gte',
  'lte',
];

/** One condition row in the visual builder. `value` is always the raw text the operator input holds — type inference happens on export, mirroring the URL layer (`inferAttributeScalar`). */
export interface QueryConditionRow {
  readonly id: string;
  readonly key: string;
  readonly operator: QueryConditionOperator;
  readonly value: string;
}

let rowIdCounter = 0;

/** Generates a stable-enough id for a freshly added row (keyed `{#each}` identity only — never persisted). */
export function nextQueryConditionRowId(): string {
  rowIdCounter += 1;
  return `condition-${rowIdCounter}`;
}

function emptyRow(): QueryConditionRow {
  return { id: nextQueryConditionRowId(), key: '', operator: 'eq', value: '' };
}

/** A single fresh, empty condition row — the "Add condition" affordance. */
export function createEmptyQueryConditionRow(): QueryConditionRow {
  return emptyRow();
}

/**
 * Same scalar-inference rule the URL layer uses (`attribute-filters.ts`
 * `inferAttributeScalar`) — kept as a private copy rather than imported so
 * this module has no runtime dependency direction onto the URL grammar
 * module beyond the shared `AttributeFilter` type; the two are proven to
 * agree by `query-builder.test.ts`'s round-trip-through-the-URL-serializer
 * case.
 */
function inferScalar(raw: string): AttributeScalar {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && raw.trim() !== '') return asNumber;
  return raw;
}

function isBlank(row: QueryConditionRow): boolean {
  return row.key.trim() === '' || row.value.trim() === '';
}

/**
 * Rows → `AttributeFilter[]`. Blank rows (no key or no value yet — an
 * in-progress "Add condition" row) are dropped rather than serialized.
 * `eq` rows sharing the same key are merged into one filter with an array
 * value, matching what a round trip through `parseAttributeFilters` would
 * produce for the same rows serialized to the URL and reparsed — so
 * rebuilding rows from the reparsed filters (`attributeFiltersToRows`)
 * reproduces the merged shape, not the original per-row split. Range
 * operators (gt/lt/gte/lte) keep one filter object per key+operator; a
 * later row silently wins over an earlier one sharing both, which is an
 * accepted rough edge for a rare, self-inflicted input (two lower bounds on
 * the same key) rather than added row-level validation.
 */
export function queryConditionRowsToAttributeFilters(
  rows: readonly QueryConditionRow[],
): AttributeFilter[] {
  const byKey = new Map<string, AttributeFilter>();
  const order: string[] = [];

  for (const row of rows) {
    if (isBlank(row)) continue;
    const scalar = inferScalar(row.value);
    const existing = byKey.get(row.key);
    if (existing) {
      applyOperator(existing, row.operator, scalar);
      continue;
    }
    const filter: AttributeFilter = { key: row.key };
    applyOperator(filter, row.operator, scalar);
    byKey.set(row.key, filter);
    order.push(row.key);
  }

  return order.map((key) => byKey.get(key)).filter((filter): filter is AttributeFilter => !!filter);
}

function applyOperator(
  filter: AttributeFilter,
  operator: QueryConditionOperator,
  scalar: AttributeScalar,
): void {
  if (operator === 'eq') {
    filter.value =
      filter.value === undefined
        ? scalar
        : [...(Array.isArray(filter.value) ? filter.value : [filter.value]), scalar];
    return;
  }
  filter[operator] = scalar;
}

/** `AttributeFilter[]` → rows. The inverse of the merge in `queryConditionRowsToAttributeFilters`: an array-valued `eq` filter expands into one row per array entry so every value stays independently editable/removable. */
export function attributeFiltersToQueryConditionRows(
  filters: readonly AttributeFilter[],
): QueryConditionRow[] {
  const rows: QueryConditionRow[] = [];

  for (const filter of filters) {
    if (filter.value !== undefined) {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      for (const value of values) {
        rows.push({
          id: nextQueryConditionRowId(),
          key: filter.key,
          operator: 'eq',
          value: String(value),
        });
      }
    }
    for (const operator of ['gt', 'lt', 'gte', 'lte'] as const) {
      const value = filter[operator];
      if (value !== undefined) {
        rows.push({
          id: nextQueryConditionRowId(),
          key: filter.key,
          operator,
          value: String(value),
        });
      }
    }
  }

  return rows;
}

type RawPreviewOperatorMap = Partial<
  Record<QueryConditionOperator, AttributeScalar | AttributeScalar[]>
>;

/** Read-only `{ and: [...] }` JSON projection for the design's "Raw toggle" preview panel. */
export function queryConditionRowsToRawPreview(
  rows: readonly QueryConditionRow[],
): Readonly<{ and: Record<string, RawPreviewOperatorMap>[] }> {
  const filters = queryConditionRowsToAttributeFilters(rows);
  const and = filters.map((filter) => {
    const entry: RawPreviewOperatorMap = {};
    if (filter.value !== undefined) entry.eq = filter.value;
    if (filter.gt !== undefined) entry.gt = filter.gt;
    if (filter.lt !== undefined) entry.lt = filter.lt;
    if (filter.gte !== undefined) entry.gte = filter.gte;
    if (filter.lte !== undefined) entry.lte = filter.lte;
    return { [filter.key]: entry };
  });
  return { and };
}
