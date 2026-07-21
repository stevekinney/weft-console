<script lang="ts">
  /**
   * Schedule detail (Track B, plan §9.3; design `Weft Console.dc.html`
   * "Schedule detail"): spec + next-5-fires preview, overlap policy with
   * consequence text, current/queued runs, recent runs (live, session-scoped
   * — see `live-fired-runs.svelte.ts`'s module doc for why), live update on
   * `schedule:fired` via the shared `FleetEventSource`.
   */
  import Badge from '@lostgradient/cinder/badge';
  import Button from '@lostgradient/cinder/button';
  import Callout from '@lostgradient/cinder/callout';
  import Card from '@lostgradient/cinder/card';
  import ConfirmDialog from '@lostgradient/cinder/confirm-dialog';
  import ConnectionIndicator from '@lostgradient/cinder/connection-indicator';
  import DescriptionList from '@lostgradient/cinder/description-list';
  import EmptyState from '@lostgradient/cinder/empty-state';
  import Skeleton from '@lostgradient/cinder/skeleton';
  import StatusDot from '@lostgradient/cinder/status-dot';
  import { Info, Pause, Pencil, Play, XCircle } from 'lucide-svelte';

  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toStore } from 'svelte/store';

  import { getFleetEventSource } from '../../app/engine-status.svelte.ts';
  import { getClient } from '../../lib/client.ts';
  import { faultTreatment } from '../../lib/faults.ts';
  import { computeNextFires } from '../../lib/format/cron-preview.ts';
  import { formatRelativeTime, truncateId } from '../../lib/format/index.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { getPrincipalStore, scopeGate } from '../../lib/scopes.svelte.ts';
  import { cadenceToScheduleValue, describeCadence } from './cadence.ts';
  import FaultBanner from './fault-banner.svelte';
  import { ScheduleFiredRunTracker } from './live-fired-runs.svelte.ts';
  import { overlapConsequence, overlapLabel } from './overlap-policy.ts';
  import {
    cancelSchedule,
    fetchScheduleDetail,
    pauseSchedule,
    resumeSchedule,
    scheduleDetailQueryKey,
  } from './schedule-queries.ts';
  import { scheduleStatusDescriptor } from './schedule-status.ts';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();

  const client = getClient();
  const principal = getPrincipalStore();
  const queryClient = useQueryClient();
  const fleetSource = getFleetEventSource();

  const detailQuery = createQuery(
    toStore(() => ({
      queryKey: scheduleDetailQueryKey(id),
      queryFn: () => fetchScheduleDetail(client, id),
    })),
  );

  function invalidateDetail(): void {
    void queryClient.invalidateQueries({ queryKey: scheduleDetailQueryKey(id) });
  }

  // A plain `$effect` (not `$derived`) owns the tracker's lifecycle
  // deliberately: `$effect`'s cleanup runs BEFORE the next run whenever `id`
  // changes, so the previous schedule's live subscription is always
  // disposed before a new one opens — `$derived` has no equivalent
  // teardown-before-recompute hook, which would leak a subscription per
  // navigation between two schedule detail pages.
  let firedRuns = $state<ScheduleFiredRunTracker>();

  $effect(() => {
    const tracker = new ScheduleFiredRunTracker(fleetSource, id, {
      onRelevantEvent: invalidateDetail,
    });
    firedRuns = tracker;
    return () => tracker.dispose();
  });

  const writeGate = $derived(scopeGate(principal, ['schedules:write']));

  const pauseMutation = createMutation({
    mutationFn: () => pauseSchedule(client, id),
    onSuccess: invalidateDetail,
  });
  const resumeMutation = createMutation({
    mutationFn: () => resumeSchedule(client, id),
    onSuccess: invalidateDetail,
  });
  const cancelMutation = createMutation({
    mutationFn: () => cancelSchedule(client, id),
    onSuccess: invalidateDetail,
  });

  let cancelDialogOpen = $state(false);

  function openEdit(): void {
    router.navigate(`/schedules?id=${encodeURIComponent(id)}&edit=1`);
  }

  function backToList(): void {
    router.navigate('/schedules');
  }
</script>

<div class="weft-schedule-detail">
  <button type="button" class="weft-schedule-detail__back" onclick={backToList}>
    ← Back to schedules
  </button>

  {#if $detailQuery.isPending}
    <div aria-busy="true" aria-label="Loading schedule">
      <Skeleton height="120px" />
      <Skeleton height="220px" />
    </div>
  {:else if $detailQuery.isError}
    <FaultBanner
      treatment={faultTreatment($detailQuery.error)}
      onRetry={() => void $detailQuery.refetch()}
    />
  {:else if $detailQuery.data === null}
    <EmptyState
      title="Schedule not found"
      description={`No schedule with id "${id}" exists — it may have been cancelled and purged.`}
    >
      {#snippet action()}
        <Button variant="secondary" size="sm" onclick={backToList}>Back to schedules</Button>
      {/snippet}
    </EmptyState>
  {:else}
    {@const schedule = $detailQuery.data}
    {@const status = scheduleStatusDescriptor(schedule.status)}
    {@const cadenceValue = cadenceToScheduleValue(schedule)}
    {@const nextFires = computeNextFires(cadenceValue, 5)}

    <div class="weft-schedule-detail__header">
      <div>
        <div class="weft-schedule-detail__title-row">
          <h1 class="weft-schedule-detail__id">{schedule.id}</h1>
          <Badge variant={status.variant}>{status.label}</Badge>
          {#if schedule.missedFireCount > 0}
            <Badge variant="warning">{schedule.missedFireCount} missed</Badge>
          {/if}
          <ConnectionIndicator status={fleetSource.status} />
        </div>
        <span class="weft-schedule-detail__subtitle">
          {schedule.workflowType} · {describeCadence(schedule)}
        </span>
      </div>
      <div class="weft-schedule-detail__actions">
        {#if schedule.status !== 'cancelled'}
          <Button
            variant="secondary"
            size="sm"
            disabled={writeGate.disabled}
            title={writeGate.title}
            onclick={() =>
              schedule.status === 'paused' ? $resumeMutation.mutate() : $pauseMutation.mutate()}
          >
            {#if schedule.status === 'paused'}
              <Play aria-hidden="true" size={14} /> Resume
            {:else}
              <Pause aria-hidden="true" size={14} /> Pause
            {/if}
          </Button>
        {/if}
        <Button variant="secondary" size="sm" onclick={openEdit}>
          <Pencil aria-hidden="true" size={14} /> Edit
        </Button>
        {#if schedule.status !== 'cancelled'}
          <Button
            variant="ghost"
            size="sm"
            disabled={writeGate.disabled}
            title={writeGate.title}
            onclick={() => (cancelDialogOpen = true)}
          >
            <XCircle aria-hidden="true" size={14} /> Cancel
          </Button>
        {/if}
      </div>
    </div>

    <div class="weft-schedule-detail__grid">
      <Card title="Specification">
        <DescriptionList
          items={[
            {
              term: schedule.cronExpression !== undefined ? 'Cron' : 'Interval',
              definition:
                schedule.cronExpression ??
                (schedule.intervalMs !== undefined ? `${schedule.intervalMs}ms` : '—'),
            },
            { term: 'Jitter', definition: schedule.jitterMs ? `±${schedule.jitterMs}ms` : 'None' },
            {
              term: 'Next fire',
              definition:
                schedule.nextFireAt !== null ? formatRelativeTime(schedule.nextFireAt) : '—',
            },
            { term: 'Missed fires', definition: String(schedule.missedFireCount) },
          ]}
        />
        <div class="weft-schedule-detail__next-fires">
          <div class="weft-schedule-detail__panel-label">Next 5 fires</div>
          {#if schedule.status === 'active' && nextFires.length > 0}
            <ul class="weft-schedule-detail__fires-list">
              {#each nextFires as fire (fire.id)}
                <li>{fire.label}</li>
              {/each}
            </ul>
          {:else}
            <p class="weft-schedule-detail__muted">
              Not scheduled — schedule is {status.label.toLowerCase()}.
            </p>
          {/if}
        </div>
      </Card>

      <div class="weft-schedule-detail__side">
        <Callout variant="info" title={`Overlap policy: ${overlapLabel(schedule.overlap)}`}>
          {#snippet icon()}
            <Info aria-hidden="true" size={17} />
          {/snippet}
          {overlapConsequence(schedule.overlap)}
        </Callout>

        <Card title="Current & queued runs">
          {#if schedule.currentWorkflowId !== undefined}
            <a
              class="weft-schedule-detail__current-run"
              href={router.href(`/workflows/${schedule.currentWorkflowId}`)}
            >
              <StatusDot status="online" showLabel={false} />
              <span class="weft-schedule-detail__mono"
                >{truncateId(schedule.currentWorkflowId)}</span
              >
              <Badge variant="success">running</Badge>
            </a>
          {/if}
          {#if schedule.queuedRuns > 0}
            <p class="weft-schedule-detail__queued">
              {schedule.queuedRuns} run{schedule.queuedRuns === 1 ? '' : 's'} queued — individual queued
              run ids aren't exposed by the API yet.
            </p>
          {/if}
          {#if schedule.currentWorkflowId === undefined && schedule.queuedRuns === 0}
            <p class="weft-schedule-detail__muted">No active or queued runs.</p>
          {/if}
        </Card>
      </div>
    </div>

    <Card>
      {#snippet header()}
        <span class="weft-schedule-detail__panel-header">
          <span>Recent runs</span>
          <span class="weft-schedule-detail__session-note"
            >Observed this session, since page load</span
          >
        </span>
      {/snippet}
      {#if (firedRuns?.runs.length ?? 0) === 0}
        <p class="weft-schedule-detail__muted">
          No fires observed yet this session. Weft does not currently expose historical schedule-run
          linkage — this list fills in live as the schedule fires.
        </p>
      {:else}
        <ul class="weft-schedule-detail__runs-list">
          {#each firedRuns?.runs ?? [] as run (run.workflowId)}
            <li>
              <a
                class="weft-schedule-detail__mono"
                href={router.href(`/workflows/${run.workflowId}`)}
              >
                {truncateId(run.workflowId)}
              </a>
              <span class="weft-schedule-detail__muted">{formatRelativeTime(run.firedAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>

    <ConfirmDialog
      bind:open={cancelDialogOpen}
      title="Cancel this schedule?"
      description={`"${schedule.id}" will stop firing. This can't be undone — create a new schedule to resume this cadence.`}
      confirmLabel="Cancel schedule"
      destructive
      onconfirm={() => $cancelMutation.mutate()}
    />
  {/if}
</div>

<style>
  .weft-schedule-detail {
    display: flex;
    flex-direction: column;
    gap: var(--cinder-space-4, 1rem);
    max-width: 1040px;
    margin: 0 auto;
    padding: 18px 24px 60px;
  }

  .weft-schedule-detail__back {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    color: var(--cinder-text-subtle);
    font: inherit;
    font-size: var(--cinder-text-sm);
    cursor: pointer;
    padding: 0;
  }

  .weft-schedule-detail__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
  }

  .weft-schedule-detail__title-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 5px;
    flex-wrap: wrap;
  }

  .weft-schedule-detail__id {
    margin: 0;
    font-size: var(--cinder-text-lg);
    font-weight: 600;
    font-family: var(--cinder-font-mono);
  }

  .weft-schedule-detail__subtitle {
    font-size: var(--cinder-text-sm);
    color: var(--cinder-text-subtle);
  }

  .weft-schedule-detail__actions {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
  }

  .weft-schedule-detail__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }

  @media (max-width: 900px) {
    .weft-schedule-detail__grid {
      grid-template-columns: 1fr;
    }
  }

  .weft-schedule-detail__side {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .weft-schedule-detail__next-fires {
    padding-top: 11px;
    margin-top: 11px;
    border-top: 1px solid var(--cinder-border-muted);
  }

  .weft-schedule-detail__panel-label {
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-subtle);
    margin-bottom: 6px;
  }

  .weft-schedule-detail__fires-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--cinder-font-mono);
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-muted);
  }

  .weft-schedule-detail__muted {
    margin: 0;
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-disabled);
  }

  .weft-schedule-detail__current-run {
    display: flex;
    align-items: center;
    gap: 9px;
    text-decoration: none;
    color: inherit;
  }

  .weft-schedule-detail__current-run :global(.cinder-badge) {
    margin-left: auto;
  }

  .weft-schedule-detail__queued {
    margin: 0;
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-muted);
  }

  .weft-schedule-detail__mono {
    font-family: var(--cinder-font-mono);
    font-size: var(--cinder-text-sm);
  }

  .weft-schedule-detail__panel-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }

  .weft-schedule-detail__session-note {
    font-size: var(--cinder-text-2xs);
    font-weight: 400;
    color: var(--cinder-text-disabled);
  }

  .weft-schedule-detail__runs-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .weft-schedule-detail__runs-list li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
</style>
