/**
 * App-local DOM composition over `RunStepTimeline` for click-to-select and
 * selection tinting (plan design §E, BINDING).
 *
 * ## Why this reaches into Cinder's rendered DOM instead of using a prop
 *
 * Verified against Cinder v0.16.1 (`run-step-timeline.types.ts`,
 * `run-step-timeline.svelte`): `RunStepTimeline` has no selection API at
 * all — no `selectedStepId`, no `onStepClick`, no per-step `class`/`style`
 * override, and no click handler on the rendered `<li>`. The component
 * exposes exactly two composition seams: the `children` snippet (rendered
 * INSIDE each step's body, after its metadata — not the whole row) and
 * stable `data-cinder-path`/`data-cinder-status` attributes on each `<li>`.
 * Neither lets a consumer make the ENTIRE row clickable or tinted without
 * reaching outside props.
 *
 * This module is the documented, minimal app-local composition the
 * PROJECT-BRIEF calls for in that situation ("ship the console using the
 * component as-is … or a minimal app-local composition") rather than
 * forking or wrapping `RunStepTimeline` to change its visuals. Filed
 * upstream requesting a `selectedStepId`/`onStepSelect` prop; see this
 * track's final report. Everything below is confined to this one file so
 * the Cinder-internals coupling (the `.cinder-run-step-timeline__item`
 * class name, `data-cinder-path`) has exactly one place to update if/when
 * that upstream prop lands or Cinder's markup changes.
 *
 * ## Why decoding `data-cinder-path` back to a step id is safe here
 *
 * `run-step-timeline.svelte`'s `pathKey` for every TOP-LEVEL entry (main
 * rail or a branch lane — `flattenSteps(lane.steps, '')` uses the same empty
 * prefix as the main rail) equals the step's own `id`, percent-escaped only
 * if it contains `%` or `/`. `timeline-mapping.ts` mints ids as `step-<n>`
 * (digits and a hyphen only), so escaping never triggers and the path is the
 * id verbatim — decoding is the identity function, not a fragile unescape.
 */
const RUN_STEP_ITEM_SELECTOR = '.cinder-run-step-timeline__item[data-cinder-path]';
const SELECTED_ATTRIBUTE = 'data-weft-timeline-selected';

function stepIdFromItem(item: Element): string | null {
  const path = item.getAttribute('data-cinder-path');
  if (path === null) return null;
  // Only claim paths this app minted (see module doc) — a nested/lane path
  // this module doesn't recognize is left alone rather than guessed at.
  return /^step-\d+$/.test(path) ? path : null;
}

/**
 * Delegates clicks anywhere inside `container` to the nearest recognized
 * `RunStepTimeline` row and reports its step id. Returns a cleanup function.
 */
export function attachRunStepTimelineClickSelection(
  container: HTMLElement,
  onSelectStepId: (stepId: string) => void,
): () => void {
  function handleClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const item = target.closest(RUN_STEP_ITEM_SELECTOR);
    if (item === null) return;
    const stepId = stepIdFromItem(item);
    if (stepId === null) return;
    onSelectStepId(stepId);
  }

  container.addEventListener('click', handleClick);
  return () => container.removeEventListener('click', handleClick);
}

/**
 * Imperatively syncs a marker attribute onto the rendered rows whose step id
 * is in `matchStepIds`. Idempotent — clears any stale marker before
 * re-applying. Shared low-level primitive behind both selection tinting
 * (single id, click-driven) and the Checkpoints tab's divergence highlight
 * (a whole set, driven by `alignTimelinesForDivergence` — see
 * `checkpoints/divergence.ts`) — both are "mark these rendered rows" over
 * the same Cinder-internals coupling this module exists to isolate.
 */
function markRunStepTimelineItems(
  container: HTMLElement,
  matchStepIds: ReadonlySet<string>,
  attribute: string,
): void {
  for (const item of container.querySelectorAll(`[${attribute}]`)) {
    item.removeAttribute(attribute);
  }
  for (const item of container.querySelectorAll(RUN_STEP_ITEM_SELECTOR)) {
    const stepId = stepIdFromItem(item);
    if (stepId !== null && matchStepIds.has(stepId)) item.setAttribute(attribute, '');
  }
}

/**
 * Imperatively syncs the selection tint attribute onto the rendered rows.
 * Call after every render where `selectedStepId` or the step list may have
 * changed (e.g. from a `$effect`). Idempotent — clears any stale attribute
 * before applying the current selection.
 */
export function applyRunStepTimelineSelectionHighlight(
  container: HTMLElement,
  selectedStepId: string | null,
): void {
  markRunStepTimelineItems(
    container,
    selectedStepId === null ? new Set() : new Set([selectedStepId]),
    SELECTED_ATTRIBUTE,
  );
}

const DIVERGED_ATTRIBUTE = 'data-weft-timeline-diverged';

/** Marks every rendered row whose step id is in `divergedStepIds` — used by the Checkpoints tab's side-by-side divergence view. */
export function applyRunStepTimelineDivergenceHighlight(
  container: HTMLElement,
  divergedStepIds: ReadonlySet<string>,
): void {
  markRunStepTimelineItems(container, divergedStepIds, DIVERGED_ATTRIBUTE);
}
