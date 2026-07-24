/**
 * Cinder-token-driven CodeMirror theme (plan §1.8 locked decision, §7 "no
 * ad-hoc colors — status/values map to Cinder tokens"). Every color is a
 * `var(--cinder-*)` reference, so light/dark follow the same
 * `color-scheme`/`light-dark()` mechanism the rest of the console uses
 * (`src/styles/index.css`) with no JS-side theme branching or
 * `prefers-color-scheme` duplication — the browser resolves the token, CSS
 * custom properties inherit into CodeMirror's generated DOM same as any
 * other descendant.
 *
 * Value colors mirror Cinder's own `JsonViewer`/`PayloadInspector` palette
 * (`json-viewer.css`: string→success, number→warning, boolean→danger,
 * null→muted italic, punctuation→muted) so a payload reads the same
 * whether it's being viewed read-only or edited here.
 *
 * Dynamically imported only, via `codemirror-setup.ts` — see that module's
 * doc for why this file must never be statically imported anywhere else in
 * `src/` (doing so would pull `@codemirror/*` into whatever chunk imports
 * it, defeating the lazy CodeMirror chunk plan §12 requires).
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--cinder-accent-text)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--cinder-success)' },
  { tag: tags.number, color: 'var(--cinder-warning)' },
  { tag: tags.bool, color: 'var(--cinder-danger)' },
  { tag: tags.null, color: 'var(--cinder-text-muted)', fontStyle: 'italic' },
  {
    tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation],
    color: 'var(--cinder-text-muted)',
  },
  { tag: tags.invalid, color: 'var(--cinder-danger)', textDecoration: 'underline wavy' },
]);

export const jsonSyntaxHighlighting: Extension = syntaxHighlighting(jsonHighlightStyle);

export const jsonEditorTheme: Extension = EditorView.theme({
  '&': {
    color: 'var(--cinder-text)',
    backgroundColor: 'var(--cinder-surface-inset)',
    border: '1px solid var(--cinder-border)',
    borderRadius: 'var(--cinder-radius-md)',
    fontSize: 'var(--cinder-text-sm)',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: 'var(--cinder-accent-text)',
    boxShadow: '0 0 0 2px color-mix(in oklch, var(--cinder-accent-text) 30%, transparent)',
  },
  '.cm-content': {
    fontFamily: 'var(--cinder-font-mono)',
    caretColor: 'var(--cinder-text)',
    padding: 'var(--cinder-space-2) var(--cinder-space-3)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--cinder-font-mono)',
    lineHeight: '1.6',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--cinder-accent-text) 25%, transparent) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in oklch, var(--cinder-accent-text) 6%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--cinder-surface-inset)',
    color: 'var(--cinder-text-disabled)',
    border: 'none',
  },
});

/** A per-instance min-height extension so the editor roughly matches the height a `<textarea rows={rows}>` would have used. */
export function jsonEditorHeightTheme(rows: number): Extension {
  return EditorView.theme({
    '.cm-scroller': { minHeight: `${rows * 1.6}em` },
  });
}
