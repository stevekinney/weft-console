<script lang="ts">
  /**
   * Tier-3 type-to-confirm dead-letter clear (plan §9.4 T5.3, §10.6 Tier 3:
   * "type-to-confirm (AlertDialog)"). `ConfirmDialog`'s own `typeToConfirm`
   * prop already gates the confirm button on a case-insensitive trimmed
   * match — this is the sanctioned Cinder pattern for a user-initiated
   * destructive confirmation (`confirm-dialog/README.md`: "This includes
   * high-impact destructive actions the user initiated, even ones that
   * affect other people"); `AlertDialog` is reserved for system-initiated
   * interruptions and has no `typeToConfirm`/body-input slot at all, so it
   * cannot host this flow (see `drain-dialog.svelte`'s doc comment for the
   * same distinction).
   */
  import ConfirmDialog from '@lostgradient/cinder/confirm-dialog';

  interface ClearDeadLetterDialogProps {
    readonly open: boolean;
    readonly operationId: string;
    readonly submitting: boolean;
    readonly onConfirm: () => void;
    readonly onCancel: () => void;
  }

  let {
    open = $bindable(),
    operationId,
    submitting,
    onConfirm,
    onCancel,
  }: ClearDeadLetterDialogProps = $props();
</script>

<ConfirmDialog
  bind:open
  title="Clear dead letter"
  description="This task exhausted its retry policy and will not be redriven. Clearing removes the diagnostic entry — it does not retry the task. This cannot be undone."
  confirmLabel={submitting ? 'Clearing…' : 'Clear dead letter'}
  destructive
  typeToConfirm={operationId}
  {onConfirm}
  {onCancel}
/>
