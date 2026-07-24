/**
 * A `WeakMap` from a payload editor's CodeMirror host element to its live
 * `EditorView`, written by `payload-editor.svelte` once CodeMirror mounts.
 * Only the `EditorView` *type* is imported here (erased at build time by
 * `verbatimModuleSyntax` — confirmed no runtime specifier is emitted), so
 * this file carries no `@codemirror/*` runtime dependency and is safe to
 * statically import from production code, unlike `codemirror-setup.ts`/
 * `codemirror-theme.ts`.
 *
 * Exists ONLY so `payload-editor.test-support.ts` can reach a mounted view
 * for tests that need to set its content — happy-dom doesn't implement
 * real contenteditable text-editing, so a synthetic `fireEvent.input`
 * can't reach a live CodeMirror view the way it reaches the `<textarea>`
 * fallback (see that file's doc for the full explanation). Production code
 * never reads from this registry — the `value`/`bind:value` contract is
 * the entire public interface.
 */
import type { EditorView } from '@codemirror/view';

const viewsByHost = new WeakMap<Element, EditorView>();

export function registerEditorView(host: Element, view: EditorView): void {
  viewsByHost.set(host, view);
}

export function getRegisteredEditorView(host: Element): EditorView | undefined {
  return viewsByHost.get(host);
}
