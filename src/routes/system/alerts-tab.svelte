<script lang="ts">
  /**
   * Alerts & operational warnings tab (plan §9.7 T7.6; design `Weft New
   * Surfaces.dc.html` §D). Session-scoped event log from `alert:fired`/
   * `alert:resolved`/`constraint:violated` + the four operational-warning
   * kinds — see `alerts-store.svelte.ts`'s module doc for the row model.
   *
   * ## Why this opens its own `FleetEventSource` connection
   *
   * The shell's ONE shared fleet connection (plan §5's "one fleet SSE …
   * never per-row/per-surface connections") lives in
   * `EngineStatusController.fleetSource` (`src/app/engine-status.svelte.ts`),
   * but neither it nor the `NotificationStore` it feeds is exposed via
   * Svelte context — verified across `shell.svelte`/`app.svelte`/
   * `engine-status.svelte.ts` (no `setContext` for either). `NotificationStore`
   * also isn't a substitute even if it were exposed: it's a single
   * 50-item rolling window shared across ALL 31 notification kinds
   * (`NOTIFICATION_HISTORY_LIMIT`), so a burst of ordinary workflow
   * lifecycle activity could silently evict real alerts from this view.
   * This is a genuine Foundation-layer gap (noted in the track's final
   * report, not filed as a `weft`/`cinder` upstream issue — it's this
   * console's own internal wiring), worked around locally: a second,
   * purpose-scoped `FleetEventSource` opened while this tab is mounted and
   * closed on unmount. It costs one extra SSE connection only while a
   * System user is actively viewing Alerts, which is an acceptable,
   * bounded, documented exception to the one-shared-connection rule.
   */
  import EmptyState from '@lostgradient/cinder/empty-state';
  import Badge, { type BadgeVariant } from '@lostgradient/cinder/badge';
  import { BellOff, Info } from 'lucide-svelte';
  import { onDestroy } from 'svelte';

  import { getClient } from '../../lib/client.ts';
  import { FleetEventSource, type FleetEventFrame } from '../../lib/live-source/fleet-event-source.svelte.ts';
  import { router } from '../../lib/router.svelte.ts';
  import { AlertsStore, isAlertEventKind, type AlertRow, type AlertRowState } from './alerts-store.svelte.ts';

  const client = getClient();
  const store = new AlertsStore();

  const source = new FleetEventSource({ baseUrl: client.baseUrl, headers: client.headers });
  const unsubscribe = source.subscribe((frame: FleetEventFrame) => {
    if (isAlertEventKind(frame.kind)) store.ingest(frame);
  });

  onDestroy(() => {
    unsubscribe();
    source.close();
  });

  const sessionStartedAtMs = Date.now();

  const STATE_BADGE: Readonly<Record<AlertRowState, { variant: BadgeVariant; label: string }>> = {
    firing: { variant: 'danger', label: 'Firing' },
    resolved: { variant: 'neutral', label: 'Resolved' },
    warning: { variant: 'warning', label: 'Warning' },
  };

  const EDGE_COLOR: Readonly<Record<AlertRowState, string>> = {
    firing: 'var(--cinder-danger)',
    resolved: 'var(--cinder-border)',
    warning: 'var(--cinder-warning)',
  };

  function detailsHref(row: AlertRow): string {
    return row.workflowId ? `/workflows/${row.workflowId}` : '/system';
  }

  function formatTime(atMs: number): string {
    return new Date(atMs).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>

<div class="weft-alerts-tab">
  <div class="weft-alerts-tab__header">
    <h2 class="weft-alerts-tab__title">Alerts &amp; warnings</h2>
  </div>
  <p class="weft-alerts-tab__note">
    <Info aria-hidden="true" size={13} />
    Collected since page load ({formatTime(sessionStartedAtMs)}). Not a persistent history — earlier
    alerts may exist.
  </p>

  {#if store.isEmpty}
    <EmptyState title="No alerts since page load" description="New alerts and warnings will appear here as they fire.">
      {#snippet icon()}
        <BellOff aria-hidden="true" size={20} />
      {/snippet}
      {#snippet action()}
        <a
          href={router.href('/workers?tab=diagnostics')}
          onclick={(event) => {
            event.preventDefault();
            router.navigate('/workers?tab=diagnostics');
          }}
        >
          Open Diagnostics
        </a>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="weft-alerts-tab__list">
      {#each store.rows as row (row.id)}
        {@const badge = STATE_BADGE[row.state]}
        <li class="weft-alerts-tab__row" style={`border-left-color:${EDGE_COLOR[row.state]}`} data-dim={row.state === 'resolved'}>
          <div class="weft-alerts-tab__row-body">
            <div class="weft-alerts-tab__row-title">{row.title}</div>
            <div class="weft-alerts-tab__row-detail">{row.body}</div>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
          <span class="weft-alerts-tab__row-time">{formatTime(row.emittedAtMs)}</span>
          <a
            class="weft-alerts-tab__row-link"
            href={router.href(detailsHref(row))}
            onclick={(event) => {
              event.preventDefault();
              router.navigate(detailsHref(row));
            }}
          >
            Details
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .weft-alerts-tab {
    max-width: 900px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .weft-alerts-tab__header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .weft-alerts-tab__title {
    margin: 0;
    font-size: var(--cinder-text-lg);
    font-weight: 600;
  }

  .weft-alerts-tab__note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 12px;
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-subtle);
  }

  .weft-alerts-tab__list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--cinder-surface-raised);
    border: 1px solid var(--cinder-border);
    border-radius: var(--cinder-radius-lg);
    overflow: hidden;
  }

  .weft-alerts-tab__row {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 14px;
    border-bottom: 1px solid var(--cinder-border-muted);
    border-left: 2px solid transparent;
  }

  .weft-alerts-tab__row:last-child {
    border-bottom: 0;
  }

  .weft-alerts-tab__row[data-dim='true'] {
    opacity: 0.6;
  }

  .weft-alerts-tab__row-body {
    flex: 1;
    min-width: 0;
  }

  .weft-alerts-tab__row-title {
    font-size: var(--cinder-text-xs);
    font-weight: 600;
  }

  .weft-alerts-tab__row-detail {
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-text-subtle);
    margin-top: 1px;
  }

  .weft-alerts-tab__row-time {
    flex: none;
    font-size: var(--cinder-text-2xs);
    color: var(--cinder-text-disabled);
    font-family: var(--cinder-font-mono);
  }

  .weft-alerts-tab__row-link {
    flex: none;
    font-size: var(--cinder-text-2xs);
    font-weight: 600;
  }
</style>
