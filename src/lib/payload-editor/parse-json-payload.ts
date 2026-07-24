/**
 * Pure JSON-payload parsing for the shared payload editor's own always-
 * visible inline hint (plan §10.2 "lint-on-parse errors inline"). This is
 * deliberately independent of whether CodeMirror has finished loading (or
 * ever loads at all — `payload-editor.svelte` falls back to a plain
 * `<textarea>` when it can't) so the same check drives the hint in both
 * states.
 *
 * NOT a replacement for each call site's own submit-time validation —
 * `start-wizard-state.ts`'s `parseRawPayload`, `schedule-form-state.svelte.ts`'s
 * `inputJsonError`, and the inline `parsePayload` helpers in
 * `signals-tab.svelte`/`updates-tab.svelte` still own the "is this payload
 * good enough to submit" decision for their surface; this module only
 * powers the editor's own live hint, which a caller already showing its
 * own live error suppresses (see `payload-editor.svelte`).
 *
 * Empty/whitespace-only text is treated as valid — every payload surface in
 * the console already accepts "nothing typed" as "no input."
 */
export interface JsonPayloadParseResult {
  readonly ok: boolean;
  readonly message?: string;
}

export function parseJsonPayload(text: string): JsonPayloadParseResult {
  if (text.trim().length === 0) return { ok: true };
  try {
    JSON.parse(text);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Invalid JSON.' };
  }
}
