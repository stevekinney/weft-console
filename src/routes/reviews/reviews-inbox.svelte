<script lang="ts">
  /**
   * Two-panel review inbox (plan §9.5: "Two-panel inbox (ResizablePanels):
   * pending list (countdown, red when <20% of the review window remains) +
   * detail/decision surface; stacks vertically <900px per the responsive
   * rules"). `index.svelte` owns the queries/mutation and the
   * `reviews:read` scope gate; this component owns the tri-state filter,
   * selection, the live toggle, and layout.
   *
   * Lists default Live OFF (plan §5 UI treatment) — visiting the inbox never
   * opens a second fleet SSE connection on top of the shell's own; the
   * operator opts in per visit. See `src/app/engine-status.svelte.ts` for
   * the shell's shared connection — it is not exposed via Svelte context
   * today (a Foundation-layer gap outside this track's owned paths), so
   * turning Live on here opens its own route-scoped `FleetEventSource`,
   * closed on unmount or when toggled back off.
   */
  import ConnectionIndicator from '@lostgradient/cinder/connection-indicator';
  import EmptyState from '@lostgradient/cinder/empty-state';
  import ResizablePanels from '@lostgradient/cinder/resizable-panels';
  import Segment from '@lostgradient/cinder/segment';
  import SegmentedControl from '@lostgradient/cinder/segmented-control';
  import Skeleton from '@lostgradient/cinder/skeleton';
  import Toggle from '@lostgradient/cinder/toggle';
  import Tooltip from '@lostgradient/cinder/tooltip';
  import type { ReviewListEntry } from '@lostgradient/weft';
  import { MediaQuery } from 'svelte/reactivity';

  import { useQueryClient, type CreateQueryResult } from '@tanstack/svelte-query';

  import { getClient } from '../../lib/client.ts';
  import { FleetEventSource } from '../../lib/live-source/index.ts';
  import { queryKeys } from '../../lib/query.ts';
  import { getPrincipalStore, scopeGate } from '../../lib/scopes.svelte.ts';
  import CompletedReviewRow from './completed-review-row.svelte';
  import PendingReviewRow from './pending-review-row.svelte';
  import type { ReviewDecisionSubmission } from './review-decision-form.svelte';
  import ReviewDetailPanel from './review-detail-panel.svelte';
  import {
    completedEntriesOnly,
    isReviewFleetEventKind,
    partitionPendingReviews,
    pendingEntriesOnly,
    type ReviewInboxState,
  } from './review-domain.ts';

  interface ReviewsInboxProps {
    readonly pendingQuery: CreateQueryResult<ReviewListEntry[]>;
    readonly completedQuery: CreateQueryResult<ReviewListEntry[]>;
    readonly submitting: boolean;
    readonly onSubmit: (reviewId: string, submission: ReviewDecisionSubmission) => void;
  }

  let { pendingQuery, completedQuery, submitting, onSubmit }: ReviewsInboxProps = $props();

  const client = getClient();
  const principalStore = getPrincipalStore();
  const queryClient = useQueryClient();

  const INBOX_STATES: readonly ReviewInboxState[] = ['pending', 'completed', 'timeout'];
  const STATE_LABELS: Readonly<Record<ReviewInboxState, string>> = {
    pending: 'Pending',
    completed: 'Decided',
    timeout: 'Timed out',
  };
  const NARROW_VIEWPORT_QUERY = '(max-width: 899px)';

  let inboxState = $state<ReviewInboxState>('pending');
  let selectedReviewId = $state<string | null>(null);
  let live = $state(false);
  let now = $state(Date.now());

  $effect(() => {
    const interval = setInterval(() => {
      now = Date.now();
    }, 1_000);
    return () => clearInterval(interval);
  });

  const isNarrowViewport = new MediaQuery(NARROW_VIEWPORT_QUERY, false);

  const pending = $derived(pendingEntriesOnly($pendingQuery.data ?? []));
  const completed = $derived(completedEntriesOnly($completedQuery.data ?? []));
  const partitioned = $derived(partitionPendingReviews(pending, now));

  const visibleEntries = $derived(
    inboxState === 'pending'
      ? partitioned.pending
      : inboxState === 'timeout'
        ? partitioned.timedOut
        : completed,
  );

  $effect(() => {
    if (!visibleEntries.some((entry) => entry.reviewId === selectedReviewId)) {
      selectedReviewId = visibleEntries[0]?.reviewId ?? null;
    }
  });

  const selectedEntry = $derived(
    visibleEntries.find((entry) => entry.reviewId === selectedReviewId) ?? null,
  );

  let fleetSource = $state<FleetEventSource | null>(null);
  const liveToggleGate = $derived(scopeGate(principalStore, ['events:read']));

  $effect(() => {
    if (!live || liveToggleGate.disabled) return;

    const source = new FleetEventSource({ baseUrl: client.baseUrl, headers: client.headers });
    fleetSource = source;
    const unsubscribe = source.subscribe((frame) => {
      if (!isReviewFleetEventKind(frame.kind)) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reviews.list({ status: 'pending' }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.reviews.list({ status: 'completed' }),
      });
    });

    return () => {
      unsubscribe();
      source.close();
      fleetSource = null;
    };
  });

  const isLoading = $derived($pendingQuery.isPending || $completedQuery.isPending);

  function emptyStateCopy(state: ReviewInboxState): { title: string; description: string } {
    if (state === 'pending') {
      return { title: 'All caught up', description: 'No reviews are waiting on a decision.' };
    }
    if (state === 'timeout') {
      return {
        title: 'Nothing timed out',
        description: 'No pending reviews have passed their deadline.',
      };
    }
    return { title: 'No decisions yet', description: 'Decided reviews appear here.' };
  }
</script>

<div class="weft-reviews-inbox">
  <div class="weft-reviews-inbox__toolbar">
    <SegmentedControl
      id="reviews-inbox-state"
      selectionMode="single"
      label="Review state"
      value={inboxState}
      onchange={(value) => (inboxState = value as ReviewInboxState)}
    >
      {#each INBOX_STATES as state (state)}
        <Segment value={state}>{STATE_LABELS[state]}</Segment>
      {/each}
    </SegmentedControl>

    <div class="weft-reviews-inbox__live">
      {#if live}
        <ConnectionIndicator status={fleetSource?.status ?? 'connecting'} />
      {/if}
      {#if liveToggleGate.disabled}
        <Tooltip text={liveToggleGate.title ?? ''}>
          <Toggle id="reviews-inbox-live" label="Live" checked={live} disabled />
        </Tooltip>
      {:else}
        <Toggle id="reviews-inbox-live" label="Live" bind:checked={live} />
      {/if}
    </div>
  </div>

  {#if isLoading}
    <div class="weft-reviews-inbox__skeleton" aria-busy="true" aria-label="Loading reviews">
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
      <Skeleton height="4rem" />
    </div>
  {:else}
    <ResizablePanels
      class="weft-reviews-inbox__panels"
      orientation={isNarrowViewport.current ? 'vertical' : 'horizontal'}
      panes={[
        {
          id: 'list',
          label: 'Reviews list',
          defaultSize: { value: 300, unit: 'px' },
          minSize: { value: 220, unit: 'px' },
        },
        { id: 'detail', label: 'Review detail' },
      ]}
    >
      {#snippet children(pane)}
        {#if pane.id === 'list'}
          <div class="weft-reviews-inbox__list-pane">
            {#if visibleEntries.length === 0}
              {@const copy = emptyStateCopy(inboxState)}
              <EmptyState title={copy.title} description={copy.description} />
            {:else}
              <div class="weft-reviews-inbox__count">
                {visibleEntries.length}
                {STATE_LABELS[inboxState].toLowerCase()}
              </div>
              <ul class="weft-reviews-inbox__list">
                {#each visibleEntries as entry (entry.reviewId)}
                  <li>
                    {#if entry.status === 'pending'}
                      <PendingReviewRow
                        {entry}
                        {now}
                        selected={entry.reviewId === selectedReviewId}
                        onSelect={(id) => (selectedReviewId = id)}
                      />
                    {:else}
                      <CompletedReviewRow
                        {entry}
                        {now}
                        selected={entry.reviewId === selectedReviewId}
                        onSelect={(id) => (selectedReviewId = id)}
                      />
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {:else if selectedEntry}
          <div class="weft-reviews-inbox__detail-pane">
            <ReviewDetailPanel entry={selectedEntry} {now} {submitting} {onSubmit} />
          </div>
        {:else}
          <div class="weft-reviews-inbox__detail-pane">
            <EmptyState title="No review selected" description="Choose a review from the list." />
          </div>
        {/if}
      {/snippet}
    </ResizablePanels>
  {/if}
</div>
