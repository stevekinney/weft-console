<script lang="ts">
  /**
   * Workers route root (plan §9.4, §13 T5.1–T5.4): Fleet overview / Workers /
   * Task queues / Diagnostics tabs, URL-owned (`?tab=`, `?worker=`,
   * `?queue=`) per plan §4 "URL owns filter/pagination/tab state". Owns the
   * three list queries, every mutation, and the drain/clear-dead-letter
   * dialogs; view components stay presentational.
   *
   * ## Live connect/disconnect (plan §9.4 T5.1)
   *
   * `EmptyState`+`Lock` gates the whole surface on `system:read`; an opt-in
   * "Live" toggle (default OFF per plan §5 UI treatment) opens its OWN
   * scoped `FleetEventSource`, filtered to `worker:connected`/
   * `worker:disconnected`, invalidating the three queries on either —
   * mirroring the Reviews track's identical pattern and its identical
   * reason (`reviews-inbox.svelte`'s doc comment): the shell's shared fleet
   * connection is not exposed via Svelte context today (a Foundation-layer
   * gap outside every track's owned paths — `src/app/shell/route-outlet.svelte`
   * renders route components with no props, and nothing in `src/app/**`
   * puts it in context either). The always-on 30s poll
   * (`workers-data.ts`'s `REFETCH_INTERVAL_MS`) is the "polling fallback"
   * half of the requirement and runs regardless of the Live toggle.
   *
   * ## Reconnect-grace-period nuance (plan §9.4)
   *
   * Deliberately NOT modeled as a distinct UI state — see
   * `worker-presentation.ts`'s module doc for why no wire signal exists to
   * derive one from, and why "never flap to disconnected" is satisfied
   * structurally instead (every view here renders directly from the current
   * `weft.workers.list` snapshot; nothing here ever synthesizes a
   * client-side "disconnected" row).
   */
  import ConnectionIndicator from '@lostgradient/cinder/connection-indicator';
  import EmptyState from '@lostgradient/cinder/empty-state';
  import Skeleton from '@lostgradient/cinder/skeleton';
  import Tab from '@lostgradient/cinder/tab';
  import TabList from '@lostgradient/cinder/tab-list';
  import TabPanel from '@lostgradient/cinder/tab-panel';
  import Tabs from '@lostgradient/cinder/tabs';
  import Toggle from '@lostgradient/cinder/toggle';
  import Tooltip from '@lostgradient/cinder/tooltip';
  import Lock from 'lucide-svelte/icons/lock';

  import { useQueryClient } from '@tanstack/svelte-query';

  import { getClient } from '../../lib/client.ts';
  import { FAULT_TREATMENT_TITLE, faultTreatment } from '../../lib/faults.ts';
  import { FleetEventSource } from '../../lib/live-source/index.ts';
  import { queryKeys } from '../../lib/query.ts';
  import { router } from '../../lib/router.svelte.ts';
  import {
    getPrincipalStore,
    isForbidden,
    scopeGate,
    scopeReason,
  } from '../../lib/scopes.svelte.ts';
  import type { DrainTarget } from './drain-dialog.svelte';
  import DrainDialog from './drain-dialog.svelte';
  import ClearDeadLetterDialog from './clear-dead-letter-dialog.svelte';
  import DiagnosticsView from './diagnostics-view.svelte';
  import FleetView from './fleet-view.svelte';
  import QueueDetailView from './queue-detail-view.svelte';
  import QueueListView from './queue-list-view.svelte';
  import WorkerDetailView from './worker-detail-view.svelte';
  import WorkerListView from './worker-list-view.svelte';
  import {
    clearDeadLetterMutation,
    drainDeploymentMutation,
    drainWorkerMutation,
    resumeDeploymentMutation,
    resumeWorkerMutation,
    taskDiagnosticsQuery,
    taskQueuesListQuery,
    workersListQuery,
  } from './workers-data.ts';

  const client = getClient();
  const principalStore = getPrincipalStore();
  const queryClient = useQueryClient();

  const locked = $derived(!principalStore.hasScope('system:read'));
  const adminGate = $derived(scopeGate(principalStore, ['system:admin']));

  const workersQuery = workersListQuery(client);
  const queuesQuery = taskQueuesListQuery(client);
  const diagnosticsQuery = taskDiagnosticsQuery(client);

  $effect(() => {
    if (
      isForbidden($workersQuery.error) ||
      isForbidden($queuesQuery.error) ||
      isForbidden($diagnosticsQuery.error)
    ) {
      principalStore.denyScope('system:read');
    }
  });

  type TabId = 'fleet' | 'list' | 'queues' | 'diagnostics';
  const TAB_IDS: readonly TabId[] = ['fleet', 'list', 'queues', 'diagnostics'];
  const TAB_LABELS: Readonly<Record<TabId, string>> = {
    fleet: 'Fleet overview',
    list: 'Workers',
    queues: 'Task queues',
    diagnostics: 'Diagnostics',
  };

  function isTabId(value: string | null): value is TabId {
    return value !== null && (TAB_IDS as readonly string[]).includes(value);
  }

  const activeTab = $derived<TabId>(
    isTabId(router.search.get('tab')) ? (router.search.get('tab') as TabId) : 'fleet',
  );
  const selectedWorkerId = $derived(router.search.get('worker'));
  const selectedQueueName = $derived(router.search.get('queue'));

  function selectTab(next: string): void {
    const params = new URLSearchParams();
    params.set('tab', next);
    router.navigate(`/workers?${params.toString()}`);
  }

  // ---------------------------------------------------------------------
  // Live toggle — own-scoped FleetEventSource (module doc above).
  // ---------------------------------------------------------------------
  let live = $state(false);
  let fleetSource = $state<FleetEventSource | null>(null);
  const liveToggleGate = $derived(scopeGate(principalStore, ['events:read']));

  const WORKER_LIVENESS_KINDS = new Set(['worker:connected', 'worker:disconnected']);

  $effect(() => {
    if (!live || liveToggleGate.disabled) return;

    const source = new FleetEventSource({ baseUrl: client.baseUrl, headers: client.headers });
    fleetSource = source;
    const unsubscribe = source.subscribe((frame) => {
      if (!WORKER_LIVENESS_KINDS.has(frame.kind)) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.workers.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.queues.list() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.diagnostics() });
    });

    return () => {
      unsubscribe();
      source.close();
      fleetSource = null;
    };
  });

  // ---------------------------------------------------------------------
  // Mutations + dialogs
  // ---------------------------------------------------------------------
  function refetchAll(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workers.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.queues.list() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.diagnostics() });
  }

  const drainWorker = drainWorkerMutation(client, refetchAll);
  const resumeWorker = resumeWorkerMutation(client, refetchAll);
  const drainDeployment = drainDeploymentMutation(client, refetchAll);
  const resumeDeployment = resumeDeploymentMutation(client, refetchAll);
  const clearDeadLetterAction = clearDeadLetterMutation(client, refetchAll);

  let drainDialogOpen = $state(false);
  let drainTarget = $state<DrainTarget | null>(null);

  function openDrainDialog(target: DrainTarget): void {
    drainTarget = target;
    drainDialogOpen = true;
  }

  function handleDrainConfirm(reason: string | undefined): void {
    if (!drainTarget) return;
    if (drainTarget.kind === 'worker') {
      $drainWorker.mutate({
        workerId: drainTarget.id,
        ...(reason !== undefined ? { reason } : {}),
      });
    } else {
      $drainDeployment.mutate({
        deploymentName: drainTarget.name,
        ...(reason !== undefined ? { reason } : {}),
      });
    }
    drainDialogOpen = false;
  }

  function resumeWorkerById(workerId: string): void {
    $resumeWorker.mutate({ workerId });
  }

  function resumeDeploymentByName(deploymentName: string): void {
    $resumeDeployment.mutate({ deploymentName });
  }

  let clearDialogOpen = $state(false);
  let clearOperationId = $state<string | null>(null);

  function openClearDialog(operationId: string): void {
    clearOperationId = operationId;
    clearDialogOpen = true;
  }

  function handleClearConfirm(): void {
    if (!clearOperationId) return;
    $clearDeadLetterAction.mutate({ operationId: clearOperationId });
    clearDialogOpen = false;
  }

  // ---------------------------------------------------------------------
  // Derived view slices
  // ---------------------------------------------------------------------
  const selectedWorker = $derived(
    selectedWorkerId
      ? (($workersQuery.data?.items ?? []).find((worker) => worker.id === selectedWorkerId) ?? null)
      : null,
  );

  const selectedQueue = $derived(
    selectedQueueName
      ? (($queuesQuery.data?.items ?? []).find((queue) => queue.queue === selectedQueueName) ??
          null)
      : null,
  );

  const workersOnSelectedQueue = $derived(
    selectedQueueName
      ? ($workersQuery.data?.items ?? []).filter((worker) => worker.queue === selectedQueueName)
      : [],
  );

  const deadLetteredOnSelectedQueue = $derived(
    selectedQueueName
      ? ($diagnosticsQuery.data?.items ?? []).filter(
          (item) => item.kind === 'dead-lettered' && item.queue === selectedQueueName,
        )
      : [],
  );

  // Each tab gates on its OWN query, not a blanket loading/error state for
  // the whole route — a failure fetching, say, task queues must not hide an
  // already-successful Diagnostics tab behind a shared error screen.
  const fleetLoading = $derived($workersQuery.isPending);
  const fleetError = $derived($workersQuery.error ?? null);
  const queuesLoading = $derived($queuesQuery.isPending);
  const queuesError = $derived($queuesQuery.error ?? null);
  const diagnosticsLoading = $derived($diagnosticsQuery.isPending);
  const diagnosticsErrorValue = $derived($diagnosticsQuery.error ?? null);
</script>

<div class="weft-workers-route">
  <div class="weft-workers-route__header">
    <h1 class="weft-workers-route__title">Workers</h1>
    {#if !locked}
      <div class="weft-workers-route__live">
        {#if live}
          <ConnectionIndicator status={fleetSource?.status ?? 'connecting'} />
        {:else}
          <ConnectionIndicator status="polling" label="Updated every 30s" />
        {/if}
        {#if liveToggleGate.disabled}
          <Tooltip text={liveToggleGate.title ?? ''}>
            <Toggle id="workers-live" label="Live" checked={live} disabled />
          </Tooltip>
        {:else}
          <Toggle id="workers-live" label="Live" bind:checked={live} />
        {/if}
      </div>
    {/if}
  </div>

  {#if locked}
    <EmptyState title="Workers are locked" description={scopeReason('system:read')}>
      {#snippet icon()}
        <Lock size={28} aria-hidden="true" />
      {/snippet}
    </EmptyState>
  {:else}
    <Tabs value={activeTab} onValueChange={(next) => selectTab(next)}>
      <TabList label="Workers views">
        {#each TAB_IDS as id (id)}
          <Tab value={id}>{TAB_LABELS[id]}</Tab>
        {/each}
      </TabList>

      <TabPanel value="fleet">
        {#if fleetLoading}
          <div class="weft-workers-route__skeleton" aria-busy="true" aria-label="Loading fleet">
            <Skeleton height="1.5rem" width="40%" />
            <Skeleton height="8rem" />
          </div>
        {:else if fleetError}
          <EmptyState
            title={FAULT_TREATMENT_TITLE[faultTreatment(fleetError).kind]}
            description={faultTreatment(fleetError).message}
          />
        {:else}
          <FleetView
            workers={$workersQuery.data?.items ?? []}
            deployments={$workersQuery.data?.deployments ?? []}
            {adminGate}
            onDrainDeployment={(name) => openDrainDialog({ kind: 'deployment', name })}
            onResumeDeployment={resumeDeploymentByName}
          />
        {/if}
      </TabPanel>

      <TabPanel value="list">
        {#if fleetLoading}
          <div class="weft-workers-route__skeleton" aria-busy="true" aria-label="Loading workers">
            <Skeleton height="1.5rem" width="40%" />
            <Skeleton height="8rem" />
          </div>
        {:else if fleetError}
          <EmptyState
            title={FAULT_TREATMENT_TITLE[faultTreatment(fleetError).kind]}
            description={faultTreatment(fleetError).message}
          />
        {:else if selectedWorker}
          <WorkerDetailView
            worker={selectedWorker}
            {adminGate}
            onDrain={() => openDrainDialog({ kind: 'worker', id: selectedWorker.id })}
            onResume={() => resumeWorkerById(selectedWorker.id)}
          />
        {:else}
          <WorkerListView workers={$workersQuery.data?.items ?? []} />
        {/if}
      </TabPanel>

      <TabPanel value="queues">
        {#if queuesLoading}
          <div
            class="weft-workers-route__skeleton"
            aria-busy="true"
            aria-label="Loading task queues"
          >
            <Skeleton height="1.5rem" width="40%" />
            <Skeleton height="8rem" />
          </div>
        {:else if queuesError}
          <EmptyState
            title={FAULT_TREATMENT_TITLE[faultTreatment(queuesError).kind]}
            description={faultTreatment(queuesError).message}
          />
        {:else if selectedQueue}
          <QueueDetailView
            queue={selectedQueue}
            routingPolicy={$workersQuery.data?.routingPolicy ?? 'least-loaded'}
            workersOnQueue={workersOnSelectedQueue}
            deadLetteredItems={deadLetteredOnSelectedQueue}
            {adminGate}
            onClearDeadLetter={openClearDialog}
          />
        {:else}
          <QueueListView
            queues={$queuesQuery.data?.items ?? []}
            diagnostics={$diagnosticsQuery.data?.items ?? []}
          />
        {/if}
      </TabPanel>

      <TabPanel value="diagnostics">
        {#if diagnosticsLoading}
          <div
            class="weft-workers-route__skeleton"
            aria-busy="true"
            aria-label="Loading diagnostics"
          >
            <Skeleton height="1.5rem" width="40%" />
            <Skeleton height="8rem" />
          </div>
        {:else if diagnosticsErrorValue}
          <EmptyState
            title={FAULT_TREATMENT_TITLE[faultTreatment(diagnosticsErrorValue).kind]}
            description={faultTreatment(diagnosticsErrorValue).message}
          />
        {:else}
          <DiagnosticsView
            items={$diagnosticsQuery.data?.items ?? []}
            summary={$diagnosticsQuery.data?.summary ?? {
              stuckQueued: 0,
              staleInflight: 0,
              retryStorms: 0,
              allWorkersAtCapacity: 0,
              deadLettered: 0,
            }}
            now={Date.now()}
          />
        {/if}
      </TabPanel>
    </Tabs>
  {/if}
</div>

{#if drainTarget}
  <DrainDialog
    bind:open={drainDialogOpen}
    target={drainTarget}
    submitting={$drainWorker.isPending || $drainDeployment.isPending}
    onDrain={handleDrainConfirm}
    onCancel={() => (drainDialogOpen = false)}
  />
{/if}

{#if clearOperationId}
  <ClearDeadLetterDialog
    bind:open={clearDialogOpen}
    operationId={clearOperationId}
    submitting={$clearDeadLetterAction.isPending}
    onConfirm={handleClearConfirm}
    onCancel={() => (clearDialogOpen = false)}
  />
{/if}
