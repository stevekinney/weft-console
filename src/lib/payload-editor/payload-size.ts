/**
 * Large-payload threshold for the shared payload editor (plan §10.2:
 * ">100 KB payload warning suggesting `ctx.offload()`"). Measured in UTF-8
 * encoded bytes, matching what `storage/storage-client.ts`'s `storagePut`
 * actually writes (`new TextEncoder().encode(value)`) and what
 * `src/lib/format/index.ts`'s `formatBytes` displays — plain
 * `string.length` undercounts multi-byte characters.
 */
const LARGE_PAYLOAD_THRESHOLD_BYTES = 100 * 1024;

export function payloadByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function isLargePayload(text: string): boolean {
  return payloadByteLength(text) > LARGE_PAYLOAD_THRESHOLD_BYTES;
}
