<script lang="ts">
  /**
   * Events tab (plan T2.5, §9.2): `EventStreamViewer` + live tail via
   * `WorkflowTailSource`, cursor resume (owned by `WorkflowTailSource`
   * itself), and the Download menu (§G: "Event history · JSON" / "Events +
   * timeline · JSON", pure client-side over `GET …/events`).
   *
   * ## Checkpoint markers, not a rich event stream
   *
   * Verified empirically (start a dev-harness `signal-stepped` fixture run,
   * send it a signal, diff `GET …/events` before/after): the durable
   * per-workflow event log records ONLY `workflow:checkpoint` entries
   * (`{ step }`) — no `WorkflowStarted`/`ActivityCompleted`/`SignalReceived`
   * entries ever appear there, regardless of what the fleet/tail channels'
   * `EVENTS_READ_EVENT_TYPES` enum documents. This tab renders exactly what
   * the API returns, honestly labeled ("Checkpoint · step N") rather than
   * implying a richer stream than exists. The rich per-operation view lives
   * on the Timeline tab (T3.1, `getTimeline()`).
   *
   * ## Live tail in the dev harness
   *
   * `scripts/dev-server.ts`'s own module doc: the per-workflow WS/SSE tail
   * 501s in this harness (weft#714, already filed by Foundation/T1.4 — "no
   * route consumes WorkflowTailSource yet ... Workflow Detail is still a
   * Phase-2 placeholder"). This tab is that first consumer. `WorkflowTailSource`
   * reconnects forever on a 501 (no attempt ceiling, plan §5.1), so the
   * `ConnectionIndicator` correctly shows `reconnecting` indefinitely against
   * this harness while the seeded historical events stay visible — the
   * intended degrade-to-last-known-state behavior, not a bug to work around.
   *
   * ## Track A3 addition: linked selection (design §E, BINDING)
   *
   * Selecting a Timeline step filters this tab to the matching checkpoint
   * row(s) — see `./timeline/timeline-selection-store.svelte.ts`'s module
   * doc for why the store lives in that track's files and is just imported
   * here. `EventStreamViewer` has no per-row highlight/dim prop (verified:
   * `event-stream-viewer.types.ts` — `events` is the only content input),
   * so "filters" here narrows the array passed in rather than the design
   * mock's literal indigo-edge/dim treatment; the Timeline track's report
   * covers the upstream Cinder gap. The mock's exact copy also names
   * "Events and Logs" — this tab only ever says "Events": Logs is a
   * permanent empty state (see `logs-tab.svelte`), so there is nothing
   * there to filter and claiming otherwise would overclaim.
   */
  import Badge from '@lostgradient/cinder/badge';
  import Button from '@lostgradient/cinder/button';
  import ConnectionIndicator from '@lostgradient/cinder/connection-indicator';
  import Dropdown from '@lostgradient/cinder/dropdown';
  import EventStreamViewer, {
    type EventStreamEntry,
    type EventStreamState,
  } from '@lostgradient/cinder/event-stream-viewer';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { HttpClient } from '@lostgradient/weft/client';
  import type { WorkflowEvent, WorkflowState } from '@lostgradient/weft';
  import { Filter, X } from 'lucide-svelte';
  import { onDestroy } from 'svelte';
  import { toStore } from 'svelte/store';

  import type { LiveSourceStatus } from '../../../lib/live-source/index.ts';
  import {
    applyWorkflowTailFrame,
    workflowEventsKey,
  } from '../../../lib/live-source/cache-integration.ts';
  import type { WorkflowEventTailOpener } from '../../../lib/live-source/workflow-tail-source.svelte.ts';
  import { WorkflowTailSource } from '../../../lib/live-source/workflow-tail-source.svelte.ts';
  import { stepNumberFromRunStepId } from './timeline/timeline-mapping.ts';
  import { clearTimelineSelection, timelineSelectionFor } from './timeline/timeline-selection-store.svelte.ts';
  import {
    buildEventHistoryExport,
    buildEventsAndTimelineExport,
    downloadJson,
    exportFilename,
  } from './export-events.ts';
  import { isTerminalStatus } from './workflow-status.ts';

  interface EventsTabProps {
    readonly client: Pick<HttpClient, 'getEvents' | 'getTimeline'> & WorkflowEventTailOpener;
    readonly workflow: WorkflowState;
  }

  let { client, workflow }: EventsTabProps = $props();

  const queryClient = useQueryClient();

  // Called once at init, not reactively — see `TimelineTab`'s identical
  // comment: `timelineSelectionFor` conditionally mutates the shared store,
  // which Svelte forbids inside a `$derived`, and `workflow.id` is stable
  // for this component's whole lifetime regardless.
  const selection = timelineSelectionFor(workflow.id);

  const eventsQuery = createQuery(
    toStore(() => ({
      queryKey: workflowEventsKey(workflow.id),
      queryFn: () => client.getEvents(workflow.id),
    })),
  );

  // Seed the live-tail cache from the initial fetch exactly once, so the
  // tail's incremental appends (`applyWorkflowTailFrame`) build on the same
  // history rather than a separate, never-populated entry — see
  // `cache-integration.ts`'s module doc on the shared `workflowEventsKey`
  // contract this track is the first consumer of.
  $effect(() => {
    if (!$eventsQuery.isSuccess) return;
    queryClient.setQueryData<WorkflowEvent[]>(workflowEventsKey(workflow.id), (old) =>
      old === undefined ? $eventsQuery.data : old,
    );
  });

  // Reads `workflow.status` once, as `$state`'s INITIAL value only (plan §5:
  // "Live default on while the workflow is running") — the user can then
  // toggle `live` independently; it does not keep tracking `workflow.status`
  // after mount, which is intentional (a running workflow that just
  // completed shouldn't yank the toggle out from under the operator).
  let live = $state(!isTerminalStatus(workflow.status));
  let tail = $state<WorkflowTailSource | null>(null);

  function startTail(): void {
    if (tail !== null) return;
    const source = new WorkflowTailSource(client, workflow.id);
    source.subscribe((event) => applyWorkflowTailFrame(queryClient, workflow.id, event));
    tail = source;
  }

  function stopTail(): void {
    tail?.close();
    tail = null;
  }

  $effect(() => {
    if (live) startTail();
    else stopTail();
  });

  onDestroy(stopTail);

  function isRecordWithStep(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  function toStreamEntry(event: WorkflowEvent, index: number): EventStreamEntry {
    const step = isRecordWithStep(event.data) ? event.data['step'] : undefined;
    return {
      id: `${event.timestamp}-${index}`,
      datetime: new Date(event.timestamp).toISOString(),
      severity: 'info',
      summary:
        event.type === 'workflow:checkpoint' && typeof step === 'number'
          ? `Checkpoint · step ${step}`
          : event.type,
      details: event.data,
    };
  }

  const allStreamEvents = $derived<EventStreamEntry[]>(
    ($eventsQuery.data ?? []).map((event, index) => toStreamEntry(event, index)),
  );

  const selectedStep = $derived(
    selection.selectedStepId === null ? null : stepNumberFromRunStepId(selection.selectedStepId),
  );

  // Filters (narrows) rather than tints/dims — see module doc for why.
  const streamEvents = $derived<EventStreamEntry[]>(
    selectedStep === null
      ? allStreamEvents
      : ($eventsQuery.data ?? [])
          .map((event, index) => ({ event, entry: toStreamEntry(event, index) }))
          .filter(
            ({ event }) =>
              isRecordWithStep(event.data) && event.data['step'] === selectedStep,
          )
          .map(({ entry }) => entry),
  );

  function tailToStreamState(status: LiveSourceStatus): EventStreamState {
    switch (status) {
      case 'live':
        return 'connected';
      case 'connecting':
      case 'reconnecting':
        return 'connecting';
      case 'closed':
        return 'disconnected';
      case 'stale':
      case 'polling':
        return 'connected';
      default:
        return 'disconnected';
    }
  }

  const connectionState = $derived<EventStreamState | undefined>(
    tail === null ? undefined : tailToStreamState(tail.status),
  );

  async function downloadEventsOnly(): Promise<void> {
    const events = $eventsQuery.data ?? [];
    downloadJson(
      buildEventHistoryExport(workflow.id, events),
      exportFilename(workflow.id, 'events'),
    );
  }

  async function downloadEventsAndTimeline(): Promise<void> {
    const events = $eventsQuery.data ?? [];
    const timeline = await client.getTimeline(workflow.id);
    downloadJson(
      buildEventsAndTimelineExport(workflow.id, events, timeline),
      exportFilename(workflow.id, 'events-and-timeline'),
    );
  }
</script>

<div class="weft-events-tab">
  <div class="weft-events-tab__toolbar">
    <ConnectionIndicator status={tail?.status ?? 'closed'} />
    <Button
      variant="ghost"
      size="sm"
      label={live ? 'Live' : 'Paused'}
      onclick={() => (live = !live)}
      aria-pressed={live}
    />
    <span class="weft-events-tab__count">{streamEvents.length} events</span>
    {#if selectedStep !== null}
      <Badge variant="accent" size="sm">
        <Filter aria-hidden="true" size={10} />
        step: {selectedStep}
        <button
          type="button"
          class="weft-events-tab__filter-clear"
          aria-label="Clear step filter"
          onclick={clearTimelineSelection}
        >
          <X aria-hidden="true" size={10} />
        </button>
      </Badge>
    {/if}
    <Dropdown id={`events-download-${workflow.id}`}>
      <Dropdown.Trigger>Download</Dropdown.Trigger>
      <Dropdown.Menu>
        <Dropdown.Item onclick={() => void downloadEventsOnly()}>Event history · JSON</Dropdown.Item
        >
        <Dropdown.Item onclick={() => void downloadEventsAndTimeline()}>
          Events + timeline · JSON
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  </div>

  {#if connectionState === undefined}
    <EventStreamViewer
      events={streamEvents}
      loading={$eventsQuery.isPending}
      label="Workflow events"
    />
  {:else}
    <EventStreamViewer
      events={streamEvents}
      {connectionState}
      loading={$eventsQuery.isPending}
      label="Workflow events"
    />
  {/if}
</div>

<style>
  /* Track A3 addition (linked selection, design §E) — scoped locally rather
     than growing `workflow-detail.css` (already at this repo's ≤500-line
     implementation-file guidance). */
  .weft-events-tab__filter-clear {
    display: inline-flex;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    margin-left: 2px;
    cursor: pointer;
  }
</style>
