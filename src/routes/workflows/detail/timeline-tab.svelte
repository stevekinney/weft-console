<script lang="ts">
  /**
   * Timeline tab (plan T3.1/T3.2, design §E linked selection + §F
   * branch/saga cards): `RunStepTimeline` from `getTimeline()`, quick
   * filters, step-range pagination + jump-to-step, linked selection with
   * Events, the finalizer strip + run-level badges, and the async-activity
   * "awaiting external completion" affordance. See the sibling modules
   * under `./timeline/` and `./async-activity/` for what's real vs.
   * honestly degraded — this component is orchestration only.
   *
   * ## Keyboard access to step selection (T9.4 accessibility pass)
   *
   * `attachRunStepTimelineClickSelection` (`./timeline/run-step-timeline-selection.ts`)
   * only ever wired a `click` listener onto the rendered `<li>` rows, and
   * Cinder's own `<li>` carries no `tabindex`/`role`/keydown handling (verified
   * against `run-step-timeline.svelte`) — so selecting a step was mouse-only,
   * and the "selected" tint (`data-weft-timeline-selected`, a plain DOM
   * attribute) had no ARIA equivalent for assistive tech either way. The
   * `children` snippet below is Cinder's one documented seam for adding real
   * interactive content inside a step's body, so the toggle button there is
   * the actual accessible control — reachable by Tab, activated by
   * Enter/Space, state exposed via `aria-pressed`. The whole-row click
   * delegation stays as a mouse-only convenience (matches
   * `workflow-table.svelte`'s and `aggregate-view.svelte`'s identical
   * pattern: a real interactive element carries the keyboard path, a row
   * `onclick` is a bonus). The button's handler stops propagation so a click
   * on it doesn't ALSO fire the row-level delegate — `selectTimelineStep`
   * toggles, so an un-stopped bubble would select-then-immediately-deselect
   * in the same click.
   */
  import Badge from '@lostgradient/cinder/badge';
  import Button from '@lostgradient/cinder/button';
  import EmptyState from '@lostgradient/cinder/empty-state';
  import Input from '@lostgradient/cinder/input';
  import RunStepTimeline, {
    type RunStepTimelineEntry,
  } from '@lostgradient/cinder/run-step-timeline';
  import SegmentedControl, { Segment } from '@lostgradient/cinder/segmented-control';
  import Skeleton from '@lostgradient/cinder/skeleton';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { WeftClientActivity, HttpClient } from '@lostgradient/weft/client';
  import type { WorkflowFinalizerStatus, WorkflowState } from '@lostgradient/weft';
  import { Clock, Link, X } from 'lucide-svelte';
  import { untrack } from 'svelte';
  import { toStore } from 'svelte/store';

  import { attachPendingActivitiesToSteps } from './async-activity/async-activity-matching.ts';
  import {
    pendingAsyncActivitiesQueryKey,
    pendingAsyncActivityObservations,
    PENDING_ASYNC_ACTIVITY_OPERATION,
  } from './async-activity/async-activity-query.ts';
  import AsyncActivityDrawer from './async-activity/async-activity-drawer.svelte';
  import FinalizerStrip from './timeline/finalizer-strip.svelte';
  import {
    applyRunStepTimelineSelectionHighlight,
    attachRunStepTimelineClickSelection,
  } from './timeline/run-step-timeline-selection.ts';
  import {
    TIMELINE_QUICK_FILTERS,
    filterTimelineEntries,
    needsTimelinePagination,
    timelineEntriesForPage,
    timelinePageCount,
    timelinePageForStep,
    timelineQuickFilterLabel,
    type TimelineQuickFilter,
  } from './timeline/timeline-filters.ts';
  import { mapTimelineToSteps } from './timeline/timeline-mapping.ts';
  import {
    clearTimelineSelection,
    selectTimelineStep,
    timelineSelectionFor,
  } from './timeline/timeline-selection-store.svelte.ts';
  import type { WorkflowLiveObservations } from './timeline/workflow-live-observations.svelte.ts';
  import { workflowTimelineQueryKey } from './workflow-timeline-data.ts';

  interface TimelineTabProps {
    readonly client: Pick<HttpClient, 'getTimeline'> & {
      readonly operations: Pick<HttpClient['operations'], typeof PENDING_ASYNC_ACTIVITY_OPERATION>;
      readonly activity: Pick<WeftClientActivity, 'complete' | 'completeExceptionally'>;
    };
    readonly workflow: WorkflowState;
    readonly liveObservations: WorkflowLiveObservations;
    /** `weft.workflows.finalizer.get` result, fetched once by `workflow-detail.svelte` and shared with the header badge — see `finalizer-strip.svelte`'s module doc. */
    readonly finalizerStatus: WorkflowFinalizerStatus | null | undefined;
  }

  let { client, workflow, liveObservations, finalizerStatus }: TimelineTabProps = $props();

  const timelineQuery = createQuery(
    toStore(() => ({
      queryKey: workflowTimelineQueryKey(workflow.id),
      queryFn: () => client.getTimeline(workflow.id),
    })),
  );

  const queryClient = useQueryClient();
  const pendingAsyncActivitiesQuery = createQuery(
    toStore(() => ({
      queryKey: pendingAsyncActivitiesQueryKey(workflow.id),
      queryFn: () =>
        client.operations[PENDING_ASYNC_ACTIVITY_OPERATION]({
          workflowId: workflow.id,
          limit: 200,
        }),
    })),
  );

  const entries = $derived($timelineQuery.data ?? []);

  let quickFilter = $state<TimelineQuickFilter>('all');
  const filteredEntries = $derived(filterTimelineEntries(entries, quickFilter));

  let pageIndex = $state(0);
  const paginated = $derived(needsTimelinePagination(filteredEntries.length));
  const pageCount = $derived(timelinePageCount(filteredEntries.length));
  const pageEntries = $derived(
    paginated ? timelineEntriesForPage(filteredEntries, pageIndex) : filteredEntries,
  );

  const steps: RunStepTimelineEntry[] = $derived(mapTimelineToSteps(pageEntries));

  // Called once at component init, not reactively: `timelineSelectionFor`
  // both reads AND (conditionally) mutates the shared module-level store,
  // which Svelte forbids inside a `$derived` evaluation. `workflow.id` is
  // stable for this component's whole lifetime regardless (the route
  // outlet's `{#key router.pathname}` guarantees a fresh mount per workflow
  // id change — see `timeline-selection-store.svelte.ts`'s module doc).
  // `untrack()` makes that one-time read explicit instead of triggering the
  // `state_referenced_locally` compiler warning.
  const selection = timelineSelectionFor(untrack(() => workflow.id));

  let containerEl = $state<HTMLDivElement | undefined>();

  $effect(() => {
    const el = containerEl;
    if (!el) return;
    return attachRunStepTimelineClickSelection(el, selectTimelineStep);
  });

  $effect(() => {
    void steps; // re-sync the highlight after every render of the rail
    if (containerEl) applyRunStepTimelineSelectionHighlight(containerEl, selection.selectedStepId);
  });

  let jumpToStepText = $state('');

  function jumpToStep(): void {
    const step = Number(jumpToStepText.trim());
    if (!Number.isSafeInteger(step)) return;
    const target = timelinePageForStep(filteredEntries, step);
    if (target !== null) pageIndex = target;
  }

  /**
   * The step-selection toggle's click handler (see the module doc's
   * "Keyboard access to step selection" section). `stopPropagation` keeps
   * this single, deliberate toggle from also being seen by
   * `attachRunStepTimelineClickSelection`'s row-level delegate, which would
   * otherwise immediately toggle the same step a second time.
   */
  function toggleStepSelection(event: MouseEvent, stepId: string): void {
    event.stopPropagation();
    selectTimelineStep(stepId);
  }

  const attachedPendingActivities = $derived(
    attachPendingActivitiesToSteps(
      pendingAsyncActivityObservations($pendingAsyncActivitiesQuery.data?.items ?? []),
      entries,
    ),
  );
  const unattachedPendingActivities = $derived(
    attachedPendingActivities.filter((activity) => activity.stepId === null),
  );

  let openDrawerToken = $state<string | null>(null);
  const openActivity = $derived(
    attachedPendingActivities.find((activity) => activity.token === openDrawerToken) ?? null,
  );

  function closeDrawer(): void {
    openDrawerToken = null;
  }

  function handleResolved(token: string): void {
    liveObservations.forgetToken(token);
    void queryClient.invalidateQueries({
      queryKey: pendingAsyncActivitiesQueryKey(workflow.id),
    });
    openDrawerToken = null;
  }
</script>

<div class="weft-timeline-tab">
  <FinalizerStrip baseStatus={workflow.status} status={finalizerStatus} />

  {#if unattachedPendingActivities.length > 0}
    <div class="weft-timeline-tab__unattached">
      {#each unattachedPendingActivities as activity (activity.token)}
        <div class="weft-timeline-tab__unattached-row">
          <Badge variant="warning">
            <Clock aria-hidden="true" size={11} />
            Awaiting external completion
          </Badge>
          <span class="weft-timeline-tab__unattached-name">{activity.activityName}</span>
          <span class="weft-timeline-tab__unattached-note">
            Couldn't link this to a single timeline step — see the run's Complete list.
          </span>
          <Button
            variant="ghost"
            size="sm"
            label="Complete…"
            onclick={() => (openDrawerToken = activity.token)}
          />
        </div>
      {/each}
    </div>
  {/if}

  {#if $timelineQuery.isPending}
    <div style="padding: 15px;"><Skeleton height="8rem" /></div>
  {:else if entries.length === 0}
    <EmptyState
      title="No timeline entries yet"
      description="Durable operations this run has performed will appear here as it executes."
    />
  {:else}
    <div class="weft-timeline-tab__toolbar">
      <SegmentedControl
        id={`timeline-quick-filter-${workflow.id}`}
        label="Quick filter"
        hideLabel
        density="toolbar"
        value={quickFilter}
        onchange={(next) => (quickFilter = next)}
      >
        {#each TIMELINE_QUICK_FILTERS as filter (filter)}
          <Segment value={filter}>{timelineQuickFilterLabel(filter)}</Segment>
        {/each}
      </SegmentedControl>

      {#if paginated}
        <div class="weft-timeline-tab__pagination">
          <Button
            variant="ghost"
            size="sm"
            label="Previous"
            disabled={pageIndex === 0}
            onclick={() => (pageIndex = Math.max(0, pageIndex - 1))}
          />
          <span class="weft-timeline-tab__page-label">Page {pageIndex + 1} of {pageCount}</span>
          <Button
            variant="ghost"
            size="sm"
            label="Next"
            disabled={pageIndex >= pageCount - 1}
            onclick={() => (pageIndex = Math.min(pageCount - 1, pageIndex + 1))}
          />
          <Input
            id={`timeline-jump-to-step-${workflow.id}`}
            label="Jump to step"
            hideLabel
            placeholder="Jump to step"
            inputmode="numeric"
            bind:value={jumpToStepText}
            onkeydown={(event) => {
              if (event.key === 'Enter') jumpToStep();
            }}
          />
          <Button variant="ghost" size="sm" label="Go" onclick={jumpToStep} />
        </div>
      {/if}
    </div>

    {#if filteredEntries.length === 0}
      <EmptyState title="No steps match this filter" description="Try a different quick filter." />
    {:else}
      <div bind:this={containerEl}>
        <RunStepTimeline {steps} label={`${workflow.type} timeline`}>
          {#snippet children(step)}
            {@const stepSelected = step.id === selection.selectedStepId}
            <button
              type="button"
              class="weft-timeline-tab__step-select"
              aria-pressed={stepSelected}
              onclick={(event) => toggleStepSelection(event, step.id)}
            >
              <Link aria-hidden="true" size={11} />
              {stepSelected ? 'Selected — filtering events' : 'Select — filter events to this step'}
            </button>
            {#if attachedPendingActivities.some((activity) => activity.stepId === step.id)}
              {@const activity = attachedPendingActivities.find(
                (candidate) => candidate.stepId === step.id,
              )}
              {#if activity}
                <div class="weft-timeline-tab__step-async">
                  <Badge variant="warning">
                    <Clock aria-hidden="true" size={11} />
                    Awaiting external completion
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Complete…"
                    onclick={() => (openDrawerToken = activity.token)}
                  />
                </div>
              {/if}
            {/if}
          {/snippet}
        </RunStepTimeline>
      </div>
    {/if}
  {/if}

  {#if selection.selectedStepId !== null}
    <div class="weft-timeline-tab__selection-chip">
      <Link aria-hidden="true" size={12} />
      Selected — Events filtered to this step
      <button
        type="button"
        class="weft-timeline-tab__selection-clear"
        onclick={clearTimelineSelection}
      >
        <X aria-hidden="true" size={11} />
        Clear
      </button>
    </div>
  {/if}
</div>

{#if openActivity}
  <AsyncActivityDrawer
    {client}
    open={true}
    activity={openActivity}
    onClose={closeDrawer}
    onResolved={handleResolved}
  />
{/if}

<style>
  .weft-timeline-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 15px;
  }

  .weft-timeline-tab__unattached {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .weft-timeline-tab__unattached-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px;
    background: var(--cinder-surface-inset);
    border-radius: var(--cinder-radius-md);
    font-size: var(--cinder-text-xs);
  }

  .weft-timeline-tab__unattached-name {
    font-weight: 600;
  }

  .weft-timeline-tab__unattached-note {
    flex: 1;
    color: var(--cinder-text-disabled);
    font-size: var(--cinder-text-2xs);
  }

  .weft-timeline-tab__toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .weft-timeline-tab__pagination {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .weft-timeline-tab__page-label {
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-text-subtle);
    white-space: nowrap;
  }

  .weft-timeline-tab__step-async {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }

  .weft-timeline-tab__selection-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    background: color-mix(in oklch, var(--cinder-accent), transparent 92%);
    border-radius: var(--cinder-radius-md);
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-accent-text);
  }

  .weft-timeline-tab__selection-clear {
    margin-left: auto;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 24px;
  }

  :global([data-weft-timeline-selected]) {
    background: color-mix(in oklch, var(--cinder-accent), transparent 90%);
    border-radius: var(--cinder-radius-md);
  }

  /* Keyboard-accessible step-selection toggle (module doc's "Keyboard access
     to step selection") — the real interactive control behind the row tint. */
  .weft-timeline-tab__step-select {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--cinder-border);
    background: var(--cinder-surface);
    color: var(--cinder-text-subtle);
    border-radius: var(--cinder-radius-sm);
    font: inherit;
    font-size: var(--cinder-text-2xs);
    padding: 3px 8px;
    min-height: 24px;
    cursor: pointer;
    margin-top: 6px;
  }

  .weft-timeline-tab__step-select:hover {
    background: var(--cinder-surface-hover);
  }

  .weft-timeline-tab__step-select[aria-pressed='true'] {
    border-color: var(--cinder-accent);
    background: color-mix(in oklch, var(--cinder-accent), transparent 85%);
    color: var(--cinder-accent-text);
  }
</style>
