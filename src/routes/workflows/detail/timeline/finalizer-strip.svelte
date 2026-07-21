<script lang="ts">
  /**
   * Finalizer strip (plan T3.2, design `Weft New Surfaces.dc.html` §F: "Weft
   * concept, not a RunStepTimeline primitive") + the run-level Finalizing /
   * Cancelled — cleanup failed badges. Renders nothing when this session has
   * observed neither signal — see `workflow-live-observations.svelte.ts` for
   * why (both are live-feed-only; there is no durable field to poll instead).
   */
  import Badge from '@lostgradient/cinder/badge';
  import StatusDot from '@lostgradient/cinder/status-dot';
  import { CircleX, Loader, Paintbrush, TriangleAlert } from 'lucide-svelte';

  import type {
    FinalizerTeardownObservation,
  } from './workflow-live-observations.svelte.ts';

  interface FinalizerStripProps {
    readonly finalizingLive: boolean;
    readonly teardown: FinalizerTeardownObservation | null;
  }

  let { finalizingLive, teardown }: FinalizerStripProps = $props();

  const visible = $derived(finalizingLive || teardown !== null);
</script>

{#if visible}
  <div class="weft-finalizer-strip">
    <div class="weft-finalizer-strip__badges">
      <span class="weft-finalizer-strip__badges-label">Special statuses</span>
      {#if finalizingLive}
        <Badge variant="warning">
          <Loader aria-hidden="true" size={11} />
          Finalizing
        </Badge>
      {:else if teardown && teardown.status !== 'completed'}
        <Badge variant="danger">
          <TriangleAlert aria-hidden="true" size={11} />
          Cancelled — cleanup failed
        </Badge>
      {/if}
    </div>

    <div class="weft-finalizer-strip__section">
      <div class="weft-finalizer-strip__section-label">
        <Paintbrush aria-hidden="true" size={12} />
        Finalizer · runs after cancellation
      </div>
      <div class="weft-finalizer-strip__row">
        {#if finalizingLive}
          <StatusDot status="pending" label="Finalizer pending" showLabel={false} />
          <span class="weft-finalizer-strip__row-name">Awaiting completion…</span>
        {:else if teardown}
          <StatusDot
            status={teardown.status === 'completed' ? 'success' : 'danger'}
            label={teardown.status === 'completed' ? 'Finalizer completed' : 'Finalizer failed'}
            showLabel={false}
          />
          <span class="weft-finalizer-strip__row-name">
            Teardown {teardown.status === 'completed' ? 'completed' : teardown.status.replace('-', ' ')}
            {#if teardown.attempts > 1}
              · {teardown.attempts} attempts
            {/if}
          </span>
          {#if teardown.status !== 'completed'}
            <Badge size="sm" variant="danger">
              <CircleX aria-hidden="true" size={10} />
              Failed
            </Badge>
          {/if}
        {/if}
      </div>
      {#if teardown?.error}
        <p class="weft-finalizer-strip__error">{teardown.error}</p>
      {/if}
      <p class="weft-finalizer-strip__caveat">
        Observed via the live event feed for this session only — weft has no durable field
        recording finalizer status, so this section is empty on a page reload once the moment
        has passed. See the workflow detail track report for the upstream request.
      </p>
    </div>
  </div>
{/if}

<style>
  .weft-finalizer-strip {
    margin-top: 12px;
    padding: 12px;
    background: var(--cinder-surface-raised);
    border: 1px solid var(--cinder-border);
    border-radius: var(--cinder-radius-lg);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .weft-finalizer-strip__badges {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .weft-finalizer-strip__badges-label {
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-text-disabled);
  }

  .weft-finalizer-strip__section {
    background: var(--cinder-surface-inset);
    border-radius: var(--cinder-radius-md);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .weft-finalizer-strip__section-label {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--cinder-text-2xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--cinder-text-subtle);
  }

  .weft-finalizer-strip__row {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: var(--cinder-text-xs);
  }

  .weft-finalizer-strip__row-name {
    flex: 1;
  }

  .weft-finalizer-strip__error {
    margin: 0;
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-color-danger-fg);
  }

  .weft-finalizer-strip__caveat {
    margin: 0;
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-text-disabled);
  }
</style>
