<script lang="ts">
  /**
   * Shared raw-JSON payload editor (plan §1.8 locked decision, §10.2
   * cross-cutting pattern) — CodeMirror 6, lazy-loaded behind a single
   * dynamic `import('./codemirror-setup.ts')` so the CodeMirror chunk
   * never enters an app route's own bundle (verified via `bun run
   * build`'s chunk output). Mounts as a plain, fully functional
   * `<textarea>` first — the exact value/validity contract every call
   * site already had with Cinder's `Textarea` — and upgrades in place
   * once the CodeMirror chunk resolves. If the import or the
   * `EditorView` construction throws for any reason (a hostile embedding
   * environment, a failed chunk fetch, a DOM that can't lay out CM's
   * measurements — happy-dom in this repo's own component tests is one
   * such environment), it stays a `<textarea>`: this editor is a
   * progressive enhancement over a Textarea, never a regression from one.
   *
   * `value` is `$bindable()`, matching every existing call site's
   * `bind:value={payloadText}` (or a function-binding pair — see
   * `configure-step.svelte`'s `bind:value={() => rawText, (next) => …}`)
   * — the smallest possible call-site diff from the `Textarea` this
   * replaces.
   *
   * The always-visible "Not valid JSON" hint below the editor is driven
   * by this component's own `parseJsonPayload` (`./parse-json-payload.ts`),
   * independent of CodeMirror's inline lint squiggle (which stays purely
   * visual/advisory inside the editor itself, via `@codemirror/lint`'s
   * `jsonParseLinter()` — see `codemirror-setup.ts`). It is suppressed
   * whenever the caller already passes its own live `error` (the Start
   * wizard's raw mode and the schedule form's "Input (JSON)" field both
   * compute their own live JSON validity already; showing this
   * component's hint on top of that would just repeat the same message).
   * Storage's put-panel passes no `error` and stores arbitrary text, not
   * necessarily JSON — the hint there is honest, informational framing
   * ("Not valid JSON"), never a blocking one.
   */
  import type { EditorView } from '@codemirror/view';

  import { formatBytes } from '../format/index.ts';
  import { registerEditorView } from './instance-registry.ts';
  import { parseJsonPayload } from './parse-json-payload.ts';
  import { isLargePayload, payloadByteLength } from './payload-size.ts';

  export interface PayloadEditorProps {
    readonly id: string;
    value?: string;
    readonly label?: string;
    readonly description?: string;
    readonly error?: string;
    /** Approximate visible height, in rows — matches Cinder `Textarea`'s `rows` prop (default 4). */
    readonly rows?: number;
    readonly class?: string;
  }

  let {
    id,
    value = $bindable(''),
    label,
    description,
    error,
    rows = 4,
    class: customClass,
  }: PayloadEditorProps = $props();

  let hostEl = $state<HTMLDivElement | undefined>();
  let editorReady = $state(false);
  let view: EditorView | undefined;
  let isApplyingExternalValue = false;

  const parseResult = $derived(parseJsonPayload(value));
  const showParseHint = $derived(!error && !parseResult.ok);
  const large = $derived(isLargePayload(value));

  const labelId = $derived(`${id}-label`);
  const descriptionId = $derived(`${id}-description`);
  const hintId = $derived(`${id}-hint`);
  const sizeWarningId = $derived(`${id}-size-warning`);
  const errorId = $derived(`${id}-error`);

  const describedBy = $derived(
    (
      [
        description ? descriptionId : undefined,
        large ? sizeWarningId : undefined,
        showParseHint ? hintId : undefined,
        error ? errorId : undefined,
      ] as const
    )
      .filter((entry): entry is string => entry !== undefined)
      .join(' ') || undefined,
  );

  // CodeMirror's content element only ever gets these attributes ONCE, at
  // construction (see the mount effect below — it intentionally does not
  // track `label`/`describedBy`/`error` as dependencies, or every keystroke
  // that changes `value` → `error` would tear down and rebuild the whole
  // editor). This effect keeps `aria-invalid`/`aria-describedby` live on
  // the mounted content element without touching the editor's extensions.
  $effect(() => {
    if (!editorReady || !view) return;
    view.contentDOM.setAttribute('aria-invalid', String(!!error));
    if (describedBy) view.contentDOM.setAttribute('aria-describedby', describedBy);
    else view.contentDOM.removeAttribute('aria-describedby');
  });

  // Mounts CodeMirror into `hostEl` exactly once per host element (i.e.
  // once per component instance) — see the comment above for why `value`/
  // `rows`/`label`/`error` are deliberately read late (after the `await`)
  // rather than destructured up front: Svelte's effect dependency tracking
  // only captures synchronous reads, so this effect's only tracked
  // dependency is `hostEl`.
  $effect(() => {
    if (!hostEl) return;
    const parent = hostEl;
    let cancelled = false;
    let createdView: EditorView | undefined;

    void (async () => {
      try {
        const { createJsonEditorView } = await import('./codemirror-setup.ts');
        if (cancelled) return;
        createdView = createJsonEditorView({
          parent,
          doc: value,
          rows,
          contentAttributes: {
            ...(label ? { 'aria-labelledby': labelId } : { 'aria-label': 'JSON payload' }),
            ...(describedBy ? { 'aria-describedby': describedBy } : {}),
            'aria-invalid': String(!!error),
          },
          onDocChanged: (next) => {
            if (isApplyingExternalValue) return;
            value = next;
          },
        });
        view = createdView;
        registerEditorView(parent, createdView);
        editorReady = true;
      } catch (loadError) {
        console.error(
          'weft-console: CodeMirror payload editor failed to load — using a plain textarea instead.',
          loadError,
        );
      }
    })();

    return () => {
      cancelled = true;
      createdView?.destroy();
      if (view === createdView) view = undefined;
      editorReady = false;
    };
  });

  // Controlled-value sync: mirrors an externally-driven `value` change
  // (e.g. the Start wizard's Back button, a mutation's `onSuccess` reset)
  // into the live CodeMirror document. `isApplyingExternalValue` stops the
  // resulting `updateListener` firing from calling `onDocChanged` and
  // looping the value straight back out.
  $effect(() => {
    const external = value;
    if (!editorReady || !view) return;
    if (view.state.doc.toString() === external) return;
    isApplyingExternalValue = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: external } });
    isApplyingExternalValue = false;
  });
</script>

<div class={['weft-payload-editor', customClass].filter(Boolean).join(' ')}>
  {#if label}
    <!-- Not `<label for={id}>` (Svelte's own a11y check flags an
         unassociated `<label>` for good reason): the focusable control
         alternates between a `<textarea>` and CodeMirror's contenteditable
         `.cm-content` (never both), and `.cm-content` doesn't reliably
         participate in native `for` association across browsers.
         `aria-labelledby` (wired to both controls, see `describedBy`'s
         neighbors above and `codemirror-setup.ts`'s `contentAttributes`)
         is the correct, WCAG-compliant technique for a control whose
         identity changes. -->
    <span id={labelId} class="weft-payload-editor__label">{label}</span>
  {/if}

  {#if !editorReady}
    <textarea
      {id}
      {rows}
      class="weft-payload-editor__fallback"
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={describedBy}
      aria-invalid={!!error}
      bind:value
    ></textarea>
  {/if}
  <div bind:this={hostEl} class="weft-payload-editor__host"></div>

  {#if description}
    <p id={descriptionId} class="weft-payload-editor__description">{description}</p>
  {/if}
  {#if large}
    <p id={sizeWarningId} class="weft-payload-editor__size-warning">
      {formatBytes(payloadByteLength(value))} — large payload, consider
      <code>ctx.offload()</code> instead.
    </p>
  {/if}
  {#if showParseHint}
    <p id={hintId} class="weft-payload-editor__hint">Not valid JSON — {parseResult.message}</p>
  {/if}
  {#if error}
    <p id={errorId} class="weft-payload-editor__error">{error}</p>
  {/if}
</div>

<style>
  .weft-payload-editor {
    display: flex;
    flex-direction: column;
    gap: var(--cinder-space-1-5);
  }

  .weft-payload-editor__label {
    font-size: var(--cinder-text-xs);
    font-weight: 600;
  }

  .weft-payload-editor__fallback {
    box-sizing: border-box;
    width: 100%;
    resize: vertical;
    font-family: var(--cinder-font-mono);
    font-size: var(--cinder-text-sm);
    line-height: 1.6;
    color: var(--cinder-text);
    background: var(--cinder-surface-inset);
    border: 1px solid var(--cinder-border);
    border-radius: var(--cinder-radius-md);
    padding: var(--cinder-space-2) var(--cinder-space-3);
  }

  .weft-payload-editor__fallback:focus-visible {
    outline: none;
    border-color: var(--cinder-accent-text);
    box-shadow: 0 0 0 2px color-mix(in oklch, var(--cinder-accent-text) 30%, transparent);
  }

  .weft-payload-editor__fallback[aria-invalid='true'] {
    border-color: var(--cinder-danger);
  }

  .weft-payload-editor__host :global(.cm-editor) {
    width: 100%;
  }

  .weft-payload-editor__description {
    margin: 0;
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-muted);
  }

  .weft-payload-editor__hint {
    margin: 0;
    font-size: var(--cinder-text-xs);
    color: var(--cinder-text-muted);
  }

  .weft-payload-editor__size-warning {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--cinder-space-1);
    font-size: var(--cinder-text-xs);
    color: var(--cinder-color-warning-fg);
  }

  .weft-payload-editor__size-warning code {
    font-family: var(--cinder-font-mono);
  }

  .weft-payload-editor__error {
    margin: 0;
    font-size: var(--cinder-text-xs);
    color: var(--cinder-danger);
  }
</style>
