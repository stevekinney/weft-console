<script lang="ts">
  /**
   * Children tab (plan T2.6): child table, derived from `getTimeline()`'s
   * `child-workflow` entries. Rows never link out — see
   * `workflow-timeline-data.ts`'s module doc for why a child's workflow id
   * can't be reliably recovered (awaited vs. detached children resolve with
   * indistinguishable shapes) — the timeline child lanes (Timeline tab,
   * T3.1) are the same degraded-but-correct story.
   */
  import Badge from '@lostgradient/cinder/badge';
  import EmptyState from '@lostgradient/cinder/empty-state';
  import Skeleton from '@lostgradient/cinder/skeleton';
  import { createQuery } from '@tanstack/svelte-query';
  import type { HttpClient } from '@lostgradient/weft/client';
  import type { WorkflowState } from '@lostgradient/weft';
  import { toStore } from 'svelte/store';

  import { formatDuration, formatRelativeTime } from '../../../lib/format/index.ts';
  import {
    childWorkflowsFromTimeline,
    workflowTimelineQueryKey,
  } from './workflow-timeline-data.ts';

  interface ChildrenTabProps {
    readonly client: Pick<HttpClient, 'getTimeline'>;
    readonly workflow: WorkflowState;
  }

  let { client, workflow }: ChildrenTabProps = $props();

  const timelineQuery = createQuery(
    toStore(() => ({
      queryKey: workflowTimelineQueryKey(workflow.id),
      queryFn: () => client.getTimeline(workflow.id),
    })),
  );

  const children = $derived(childWorkflowsFromTimeline($timelineQuery.data ?? []));

  const STATUS_VARIANT: Record<string, 'success' | 'danger' | 'neutral' | 'info'> = {
    completed: 'success',
    failed: 'danger',
    cancelled: 'neutral',
    'timed-out': 'danger',
    running: 'info',
  };
</script>

{#if $timelineQuery.isPending}
  <div class="weft-children-tab"><div style="padding: 15px;"><Skeleton height="3rem" /></div></div>
{:else if children.length === 0}
  <EmptyState
    title="No child workflows"
    description="This run hasn't started any child workflows."
  />
{:else}
  <div class="weft-children-tab">
    <div class="weft-children-tab__scroll">
      <div class="weft-children-tab__row weft-children-tab__header">
        <span>Status</span>
        <span>Type</span>
        <span>Created</span>
        <span>Duration</span>
      </div>
      {#each children as child (child.step)}
        <div class="weft-children-tab__row">
          <Badge variant={STATUS_VARIANT[child.status] ?? 'neutral'} size="sm">{child.status}</Badge
          >
          <span>{child.type}</span>
          <span
            style="font-size: var(--cinder-text-xs); color: var(--cinder-text-subtle); font-family: var(--cinder-font-mono);"
          >
            {formatRelativeTime(child.timestamp)}
          </span>
          <span
            style="font-size: var(--cinder-text-xs); color: var(--cinder-text-subtle); font-family: var(--cinder-font-mono);"
          >
            {child.duration !== undefined ? formatDuration(child.duration) : '—'}
          </span>
        </div>
      {/each}
    </div>
    <p
      style="margin: 0; padding: 10px 16px; font-size: var(--cinder-text-2xs); color: var(--cinder-text-disabled);"
    >
      Child workflow ids aren't exposed by the timeline API yet — rows aren't clickable until an
      upstream operation adds a real parent→child relationship.
    </p>
  </div>
{/if}
