/**
 * Search-attribute query builder — pure logic (plan §9.2 T2.2, §10.3).
 *
 * **Why not `InvocationRuleBuilder` (C4).** Cinder's `mode="conditions"`
 * (landed in v0.16.1) supplies the exact operator set (eq/gt/lt/gte/lte) and
 * typed value controls the plan's C4 spec asks for, so it was evaluated
 * first per PROJECT-BRIEF. It doesn't fit here for a data-model reason, not
 * a cosmetic one: `InvocationRuleBuilder` groups conditions under
 * independent named "rules" (`rules: InvocationRule[]`, each with its own
 * label/move/remove chrome that renders unconditionally — verified against
 * `invocation-rule-builder.svelte`, conditions mode only strips the actions
 * half). This console's grammar (plan §10.3, `src/lib/filters.ts` +
 * `attribute-filters.ts`) is a single flat AND-only condition set with no
 * "OR of rule groups" concept — a user building a 2nd rule group in the
 * component would produce state this app's URL/REST grammar cannot express
 * at all. That's a correctness gap, not a restyle-away cosmetic one, so per
 * PROJECT-BRIEF this ships as a minimal app-local composition
 * (`Combobox` + `Select` + `Input` rows, matching `design/Weft
 * Patterns.dc.html`'s query-builder markup exactly) with the gap filed
 * upstream (see the console's final report for the issue URL) rather than
 * cloning `InvocationRuleBuilder`'s row assembly.
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
