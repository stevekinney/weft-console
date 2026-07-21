<script lang="ts">
  /**
   * Lineage panel (plan T2.7, design `Weft New Surfaces.dc.html` §B):
   * schedule provenance row, continuation chips, forked-from row, child
   * tree. IDs `first8…last4` + hover title + copy; names — never IDs — as
   * link labels.
   *
   * ## What's real vs honestly omitted (verified against weft v0.11.0)
   *
   * - **Forked from**: real. `WorkflowState.forkedFrom` (`{ workflowId,
   *   step }`) is a public field on `GET /api/v1/workflows/:id`
   *   (`src/core/types/workflow.ts`). This panel additionally fetches the
   *   forked-from workflow's own workflow to show its TYPE as the link label
   *   (never the raw id) — falls back to the truncated id if that lookup
   *   404s (e.g. the source run was since purged).
   * - **Children**: best-effort. `getTimeline()`'s `child-workflow` entries
   *   give type/status/timing but never a reliable workflow id — see
   *   `workflow-timeline-data.ts`'s module doc for exactly why (awaited vs.
   *   detached children resolve with different, indistinguishable shapes).
   *   Rendered as a non-clickable list, captioned.
   * - **Schedule provenance / continuation chain**: NOT rendered. Verified
   *   there is no client-reachable field or operation for either:
   *   `encodeScheduleRunMetadata()` (`src/core/engine/schedule-run-metadata.ts`)
   *   writes an internal-only storage key, never returned by any public
   *   operation; a `start-new` restart's prior run is fully deleted by
   *   `prepareTerminalRunPurge()` (`src/core/engine/lifecycle/
   *   start-terminal-conflict-purge.ts`) before the new run commits, so
   *   there is no predecessor record left to link back to even in
   *   principle. Fabricating either row (or the design mock's illustrative
   *   "gen 41/42" chips) would show operators data the API cannot actually
   *   back. A single footnote names the gap instead — see this track's
   *   final report for the upstream issue.
   */
  import CopyButton from '@lostgradient/cinder/copy-button';
  import Skeleton from '@lostgradient/cinder/skeleton';
  import { createQuery } from '@tanstack/svelte-query';
  import type { HttpClient } from '@lostgradient/weft/client';
  import type { WorkflowState } from '@lostgradient/weft';
  import { CornerDownRight, GitBranch, GitFork } from 'lucide-svelte';
  import { toStore } from 'svelte/store';

  import { formatRelativeTime, truncateId } from '../../../lib/format/index.ts';
  import { queryKeys } from '../../../lib/query.ts';
  import { router } from '../../../lib/router.svelte.ts';
  import {
    childWorkflowsFromTimeline,
    workflowTimelineQueryKey,
  } from './workflow-timeline-data.ts';

  interface LineagePanelProps {
    readonly client: Pick<HttpClient, 'get' | 'getTimeline'>;
    readonly workflow: WorkflowState;
  }

  let { client, workflow }: LineagePanelProps = $props();

  const forkedFrom = $derived(workflow.forkedFrom);

  const forkSourceQuery = createQuery(
    toStore(() => ({
      queryKey: queryKeys.workflows.detail(forkedFrom?.workflowId ?? ''),
      queryFn: () => client.get(forkedFrom?.workflowId ?? ''),
      enabled: forkedFrom !== undefined,
    })),
  );

  const timelineQuery = createQuery(
    toStore(() => ({
      queryKey: workflowTimelineQueryKey(workflow.id),
      queryFn: () => client.getTimeline(workflow.id),
    })),
  );

  const children = $derived(childWorkflowsFromTimeline($timelineQuery.data ?? []));

  function goToWorkflow(id: string): void {
    router.navigate(`/workflows/${id}`);
  }
</script>

<div class="weft-lineage-panel">
  <div class="weft-lineage-panel__header">
    <GitBranch aria-hidden="true" size={15} />
    Lineage
  </div>
  <div class="weft-lineage-panel__body">
    {#if forkedFrom}
      <div class="weft-lineage-panel__row">
        <GitFork aria-hidden="true" size={14} />
        <span class="weft-lineage-panel__row-label">Forked from</span>
        {#if $forkSourceQuery.isPending}
          <Skeleton height="1rem" width="8rem" />
        {:else}
          <a
            href={router.href(`/workflows/${forkedFrom.workflowId}`)}
            onclick={(event) => {
              event.preventDefault();
              goToWorkflow(forkedFrom.workflowId);
            }}
          >
            {$forkSourceQuery.data?.type ?? `${truncateId(forkedFrom.workflowId)} run`}
          </a>
          <span class="weft-lineage-panel__id" title={forkedFrom.workflowId}>
            {truncateId(forkedFrom.workflowId)}
          </span>
          <CopyButton value={forkedFrom.workflowId} iconOnly label="Copy workflow id" />
        {/if}
        <span class="weft-lineage-panel__meta">at step {forkedFrom.step}</span>
      </div>
    {/if}

    <div>
      <div class="weft-lineage-panel__section-label">
        Child workflows{#if children.length > 0}
          &nbsp;· {children.length}{/if}
      </div>
      {#if $timelineQuery.isPending}
        <Skeleton height="1.5rem" />
      {:else if children.length === 0}
        <p class="weft-lineage-panel__note">No child workflows.</p>
      {:else}
        <div class="weft-lineage-panel__children">
          {#each children as child (child.step)}
            <div class="weft-lineage-panel__child-row">
              <CornerDownRight aria-hidden="true" size={12} />
              <span>{child.type}</span>
              <span class="weft-lineage-panel__meta">{child.status}</span>
              <span class="weft-lineage-panel__meta">{formatRelativeTime(child.timestamp)}</span>
            </div>
          {/each}
        </div>
        <p class="weft-lineage-panel__note">
          Child workflow ids aren't exposed by the timeline API yet — links are disabled until an
          upstream operation adds a real parent→child relationship (see this track's report).
        </p>
      {/if}
    </div>

    {#if !forkedFrom}
      <p class="weft-lineage-panel__note">
        Schedule provenance and continuation chains ("previous run → this run") aren't available
        from any current API — see this track's report for the upstream issue.
      </p>
    {/if}
  </div>
</div>

<style>
  .weft-lineage-panel__id {
    font-family: var(--cinder-font-mono);
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-text-subtle);
  }

  .weft-lineage-panel__meta {
    margin-left: auto;
    color: var(--cinder-text-disabled);
    font-size: var(--cinder-text-2xs);
  }
</style>
