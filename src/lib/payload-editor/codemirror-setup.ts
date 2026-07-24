/**
 * The ONLY module in this directory that statically imports `@codemirror/*`
 * (plus `codemirror-theme.ts`, which is CodeMirror-dependent itself).
 * `payload-editor.svelte` reaches this file exclusively through
 * `await import('./codemirror-setup.ts')`, never a static `import` — that
 * dynamic-import boundary is what gives CodeMirror its own lazy Rollup
 * chunk (plan §12: entry/route chunks stay CodeMirror-free; the CodeMirror
 * chunk downloads only once a payload editor actually mounts, target
 * <150 KB gz). Do not add a static `import` of this file, or of
 * `codemirror-theme.ts`, anywhere else in `src/` — `bun run build`'s chunk
 * graph is the enforcement mechanism here, not a lint rule.
 *
 * Deliberately minimal extension set — no `codemirror` "basic setup"
 * bundle (autocomplete/search/fold-gutter/close-brackets add real weight
 * this editor doesn't need for short JSON payloads) and no gutter/line
 * numbers (the design reference's payload editor is a plain code block,
 * not a line-numbered file view). No `indentWithTab`: binding Tab to
 * indentation would trap keyboard focus inside the editor, which
 * PROJECT-BRIEF's accessibility rule forbids — Tab keeps moving focus to
 * the next control, same as the `<textarea>` fallback.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter, type Diagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';

import {
  jsonEditorHeightTheme,
  jsonEditorTheme,
  jsonSyntaxHighlighting,
} from './codemirror-theme.ts';

/**
 * `jsonParseLinter()` calls `JSON.parse(doc)` verbatim, which throws on an
 * empty string — flagging a blank, untouched editor as an error before the
 * user has typed anything. Every payload surface in the console treats
 * blank as valid ("no input"), matching `parseJsonPayload`'s rule — this
 * wrapper applies the same exception so CodeMirror's inline lint marker
 * agrees with the editor's own always-visible hint instead of contradicting
 * it.
 */
function jsonPayloadLinter(): (view: EditorView) => Diagnostic[] {
  const base = jsonParseLinter();
  return (view) => (view.state.doc.toString().trim() === '' ? [] : base(view));
}

export interface CreateJsonEditorViewOptions {
  readonly parent: HTMLElement;
  readonly doc: string;
  /** Approximates a `<textarea rows={rows}>` height — see `jsonEditorHeightTheme`. */
  readonly rows: number;
  /** Applied verbatim to CodeMirror's content element (`aria-labelledby`/`aria-label`, `aria-describedby`, `aria-invalid`) — assembled by `payload-editor.svelte` so both the fallback `<textarea>` and this view stay labeled identically. */
  readonly contentAttributes: Readonly<Record<string, string>>;
  /** Fires on every document change caused by the editor itself (typing, paste, undo/redo) — never for the programmatic replacement `replaceEditorDoc` performs to mirror an external `value` change. */
  readonly onDocChanged: (value: string) => void;
}

/** Builds and mounts a JSON `EditorView` into `options.parent`. The caller owns teardown via the returned view's own `destroy()`. */
export function createJsonEditorView(options: CreateJsonEditorViewOptions): EditorView {
  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      json(),
      linter(jsonPayloadLinter()),
      jsonSyntaxHighlighting,
      jsonEditorTheme,
      jsonEditorHeightTheme(options.rows),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of(options.contentAttributes),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onDocChanged(update.state.doc.toString());
      }),
    ],
  });

  return new EditorView({ state, parent: options.parent });
}

/**
 * Replaces the full document when an external `value` change doesn't match
 * what the view currently holds — used by `payload-editor.svelte`'s
 * controlled-value-sync effect. Callers must guard their own
 * `onDocChanged` against this dispatch (a boolean flag set around the call
 * is the pattern `payload-editor.svelte` uses) so the resulting
 * `updateListener` firing doesn't loop the value straight back out.
 */
export function replaceEditorDoc(view: EditorView, next: string): void {
  if (view.state.doc.toString() === next) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
}
