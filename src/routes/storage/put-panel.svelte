<script lang="ts">
  /**
   * Put panel (plan §9.6, §10.6; design `Weft Console.dc.html` STORAGE
   * "stPut"): key + raw text value, Tier-2 `ConfirmDialog` before writing
   * (plan: "Tier-2 ConfirmDialog on writes/deletes").
   */
  import Button from '@lostgradient/cinder/button';
  import ConfirmDialog from '@lostgradient/cinder/confirm-dialog';
  import Input from '@lostgradient/cinder/input';
  import Textarea from '@lostgradient/cinder/textarea';
  import type { HttpClient } from '@lostgradient/weft/client';
  import { Save } from 'lucide-svelte';

  import { createMutation } from '@tanstack/svelte-query';

  import { showToast } from '../../app/toast-host.svelte';
  import { faultTreatment } from '../../lib/faults.ts';
  import ReservedPrefixCallout from './reserved-prefix-callout.svelte';
  import { storagePut } from './storage-client.ts';

  interface PutPanelProps {
    client: HttpClient;
  }

  let { client }: PutPanelProps = $props();

  let key = $state('');
  let value = $state('');
  let confirmOpen = $state(false);
  let triggerRef = $state<HTMLElement | null>(null);

  const putMutation = createMutation<void, unknown, { key: string; value: string }>(
    {
      mutationFn: ({ key: targetKey, value: targetValue }) =>
        storagePut(client, targetKey, new TextEncoder().encode(targetValue)),
    },
    undefined,
  );
</script>

<div class="weft-storage-form">
  <Input id="storage-put-key" label="Key" bind:value={key} class="weft-storage-monospace-input" />
  <ReservedPrefixCallout {key} />
  <Textarea
    id="storage-put-value"
    label="Value"
    bind:value
    rows={5}
    class="weft-storage-monospace-input"
  />
  <Button
    label="Put · confirm"
    variant="primary"
    size="sm"
    fullWidth
    disabled={key.length === 0}
    loading={$putMutation.isPending}
    onclick={(event) => {
      triggerRef = event.currentTarget as HTMLElement;
      confirmOpen = true;
    }}
  >
    {#snippet leadingIcon()}<Save aria-hidden="true" size={14} />{/snippet}
  </Button>
  {#if $putMutation.isError}
    <p class="weft-storage-error">{faultTreatment($putMutation.error).message}</p>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  {triggerRef}
  title={`Write to "${key}"?`}
  description="This overwrites any existing value at this key. This cannot be undone."
  confirmLabel="Write"
  onconfirm={() => {
    $putMutation.mutate(
      { key, value },
      { onSuccess: () => showToast(`Wrote "${key}"`, { variant: 'success' }) },
    );
  }}
/>
