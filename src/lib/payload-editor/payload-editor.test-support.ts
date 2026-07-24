/**
 * Test-only helper: sets a `PayloadEditor`'s content regardless of whether
 * the plain `<textarea>` fallback or a live CodeMirror view is currently
 * mounted.
 *
 * `PayloadEditor` starts as a `<textarea>` and upgrades in place to
 * CodeMirror once the (dynamically imported) `codemirror-setup` chunk
 * resolves — see `payload-editor.svelte`'s module doc. That resolves
 * within a couple of awaited ticks in this project's happy-dom harness, so
 * any multi-step test with more than one `await` between render and
 * interaction cannot assume either state stays put. happy-dom also doesn't
 * implement real contenteditable text-editing (no native text-editing
 * engine, no `execCommand`), so a synthetic `fireEvent.input` — which
 * relies on a form control's native `value` setter — can reach the
 * `<textarea>` fallback but not a live CodeMirror view. This dispatches
 * straight through CodeMirror's own transaction API instead (via
 * `replaceEditorDoc`), which is exactly what real typing drives under the
 * hood — the resulting `updateListener` firing is indistinguishable from a
 * user having typed it.
 *
 * Never imported by production code — `instance-registry.ts`'s module doc
 * has the same caveat.
 */
import { getRegisteredEditorView } from './instance-registry.ts';

/**
 * @param field An element found via `getByLabelText`/`getByRole('textbox', …)` — either the fallback `<textarea>` itself, or CodeMirror's `.cm-content` (both are labeled identically, see `payload-editor.svelte`).
 * @param text The full replacement text (this replaces the whole document/value, matching how `fireEvent.input`'s `target.value` behaves).
 */
export async function typeIntoPayloadEditor(field: Element, text: string): Promise<void> {
  if (field instanceof HTMLTextAreaElement) {
    const { fireEvent } = await import('@testing-library/svelte');
    await fireEvent.input(field, { target: { value: text } });
    return;
  }

  const host = field.closest('.weft-payload-editor__host');
  if (!host) {
    throw new Error(
      'typeIntoPayloadEditor: no payload editor control found for the given element.',
    );
  }
  const view = getRegisteredEditorView(host);
  if (!view) {
    throw new Error('typeIntoPayloadEditor: CodeMirror view is not registered yet for this host.');
  }
  const { replaceEditorDoc } = await import('./codemirror-setup.ts');
  replaceEditorDoc(view, text);

  const { tick } = await import('svelte');
  await tick();
}
