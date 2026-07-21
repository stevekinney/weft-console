<script lang="ts">
  /**
   * Bulk-selection bar — SCAFFOLD only (plan §9.2 T2.1: "bulk-select
   * checkboxes + selection bar SCAFFOLD only — count + disabled actions
   * with scope reasons; the Tier-3 flow is Phase 8, not yours"). Shows the
   * selection count and every action disabled-with-reason: the server's
   * dry-run/confirmation-token bulk protocol (plan §4, §13 Phase 8) isn't
   * wired here, so these buttons must never look actionable. "Deselect" is
   * the one real action — it only touches local selection state.
   *
   * Disabled-with-tooltip follows the same branching pattern as
   * `reviews-inbox.svelte`'s `scopeGate` usage: `<Tooltip>` around a
   * `disabled` control, not `disabled`/`title` spread onto an enabled one —
   * Cinder's `Tooltip` still triggers on hover/focus of a wrapped disabled
   * element, unlike relying on a disabled element's own (suppressed) event
   * handling.
   */
  import { RotateCw, Tags, XCircle } from 'lucide-svelte';
  import Button from '@lostgradient/cinder/button';
  import Checkbox from '@lostgradient/cinder/checkbox';
  import Tooltip from '@lostgradient/cinder/tooltip';

  interface BulkSelectionBarProps {
    selectedCount: number;
    totalMatchingFilter: number;
    /** True once "select all N matching" has been chosen — always false here (Phase 8 owns that escalation); kept as a prop so the banner text is correct once it exists. */
    selectedAllMatching?: boolean;
    onDeselect: () => void;
    /** Reason every bulk action is disabled — e.g. "Bulk operations ship in a later phase". */
    actionsDisabledReason: string;
  }

  let {
    selectedCount,
    totalMatchingFilter,
    selectedAllMatching = false,
    onDeselect,
    actionsDisabledReason,
  }: BulkSelectionBarProps = $props();

  const ACTIONS = [
    { label: 'Cancel', icon: XCircle },
    { label: 'Signal', icon: RotateCw },
    { label: 'Retry failed', icon: RotateCw },
    { label: 'Mutate tags', icon: Tags },
  ] as const;
</script>

{#if selectedCount > 0}
  <div class="weft-bulk-bar">
    {#if !selectedAllMatching && selectedCount > 0}
      <div class="weft-bulk-bar__banner">
        <Tooltip text={actionsDisabledReason}>
          <Checkbox
            checked={false}
            disabled
            label={`Select all ${totalMatchingFilter} matching the filter`}
          />
        </Tooltip>
        <span class="weft-bulk-bar__banner-hint">
          Operates on all matching, not just the visible page.
        </span>
      </div>
    {/if}
    <div class="weft-bulk-bar__row">
      <span class="weft-bulk-bar__count">{selectedCount} selected</span>
      <div class="weft-bulk-bar__actions">
        {#each ACTIONS as action (action.label)}
          <Tooltip text={actionsDisabledReason}>
            <Button variant="secondary" size="sm" disabled>
              <action.icon aria-hidden="true" size={14} />
              {action.label}
            </Button>
          </Tooltip>
        {/each}
      </div>
      <button type="button" class="weft-bulk-bar__deselect" onclick={onDeselect}>Deselect</button>
    </div>
  </div>
{/if}
