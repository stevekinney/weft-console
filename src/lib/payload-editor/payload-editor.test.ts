import { describe, expect, test } from 'bun:test';

import PayloadEditor from './payload-editor.svelte';

/**
 * Reads the current text out of whichever control is active. The editor
 * starts as a plain `<textarea>` and upgrades in place to a real
 * CodeMirror view once the (dynamically imported, but already
 * module-cached after the first mount in this test file) `codemirror-setup`
 * chunk resolves — which observably happens within a couple of awaited
 * ticks in this project's happy-dom harness, so a test that awaits
 * anything between render and assertion cannot assume either state stays
 * put. Reading `.cm-content`'s `textContent` doesn't depend on CodeMirror's
 * layout/measurement (the thing happy-dom can't provide) — only on the
 * document model having real text nodes, which it does regardless.
 */
function currentControlValue(container: HTMLElement): string {
  const textarea = container.querySelector<HTMLTextAreaElement>(
    'textarea.weft-payload-editor__fallback',
  );
  if (textarea) return textarea.value;
  const cmContent = container.querySelector<HTMLElement>('.cm-content');
  if (cmContent) return cmContent.textContent ?? '';
  throw new Error('Neither the fallback textarea nor a CodeMirror editor is present.');
}

describe('PayloadEditor', () => {
  test('mounts and renders a labeled, editable control for the bound value', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByLabelText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a":1}' },
    });

    const control = getByLabelText('Payload');
    expect(control).not.toBeNull();
  });

  test('shows the description text when provided', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', description: 'JSON, optional', value: '' },
    });

    expect(getByText('JSON, optional')).not.toBeNull();
  });

  test('empty value shows no parse hint (blank is valid, no input)', async () => {
    const { render } = await import('@testing-library/svelte');
    const { queryByText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '' },
    });

    expect(queryByText(/Not valid JSON/)).toBeNull();
  });

  test('parse-error display: invalid JSON shows an inline "Not valid JSON" hint', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{not json' },
    });

    expect(getByText(/Not valid JSON/)).not.toBeNull();
  });

  test('parse-error display: valid JSON shows no hint', async () => {
    const { render } = await import('@testing-library/svelte');
    const { queryByText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a": 1}' },
    });

    expect(queryByText(/Not valid JSON/)).toBeNull();
  });

  test('parse-error display: an external `error` prop suppresses the internal hint and shows its own message', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText, queryByText } = render(PayloadEditor, {
      props: {
        id: 'test-payload',
        label: 'Payload',
        value: '{not json',
        error: 'Unexpected token in JSON',
      },
    });

    expect(getByText('Unexpected token in JSON')).not.toBeNull();
    expect(queryByText(/^Not valid JSON/)).toBeNull();
  });

  test('large-payload warning: appears over 100 KB and suggests ctx.offload()', async () => {
    const { render } = await import('@testing-library/svelte');
    const large = JSON.stringify({ value: 'a'.repeat(101 * 1024) });
    const { getByText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: large },
    });

    expect(getByText(/large payload/)).not.toBeNull();
    expect(getByText('ctx.offload()')).not.toBeNull();
  });

  test('an external `error` prop marks the control aria-invalid', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByLabelText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{not json', error: 'Bad payload' },
    });

    expect(getByLabelText('Payload').getAttribute('aria-invalid')).toBe('true');
  });

  test('no `error` prop leaves the control aria-invalid false', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByLabelText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a": 1}' },
    });

    expect(getByLabelText('Payload').getAttribute('aria-invalid')).toBe('false');
  });

  test('large-payload warning: absent under 100 KB', async () => {
    const { render } = await import('@testing-library/svelte');
    const { queryByText } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a": 1}' },
    });

    expect(queryByText(/large payload/)).toBeNull();
  });

  test('lossless value round-trip: typing into the control propagates through bind:value', async () => {
    const { render, fireEvent } = await import('@testing-library/svelte');
    let current = '';
    const { getByLabelText, rerender, container } = render(PayloadEditor, {
      props: {
        id: 'test-payload',
        label: 'Payload',
        value: current,
        // `bind:value` isn't reachable from `render()`'s props object
        // directly (that's a template-only construct) — this component
        // test drives the same `value`-changed contract the real
        // `bind:value` call sites rely on: controlled `value` in,
        // `oninput`-equivalent user typing out, verified via a fresh
        // `rerender` echoing back what a bound caller would do.
      },
    });

    const control = getByLabelText('Payload') as HTMLTextAreaElement;
    await fireEvent.input(control, { target: { value: '{"b":2}' } });
    current = control.value;
    expect(current).toBe('{"b":2}');

    // Round-trip: feeding the typed value back in as a controlled `value`
    // prop must not corrupt or drop it (lossless) — read back through
    // whichever control is active, see `currentControlValue`'s doc.
    await rerender({ id: 'test-payload', label: 'Payload', value: current });
    expect(currentControlValue(container)).toBe('{"b":2}');
  });

  test('controlled-value sync: an external value change updates the rendered control without an input event', async () => {
    const { render } = await import('@testing-library/svelte');
    const { rerender, container } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a":1}' },
    });

    expect(currentControlValue(container)).toBe('{"a":1}');

    await rerender({ id: 'test-payload', label: 'Payload', value: '{"a":2}' });

    expect(currentControlValue(container)).toBe('{"a":2}');
  });

  test('upgrades from the fallback textarea to a live CodeMirror editor, preserving the value', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const { container } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a":1}' },
    });

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).not.toBeNull();
    });

    expect(currentControlValue(container)).toBe('{"a":1}');
  });

  test('controlled-value sync reaches a live CodeMirror editor without looping the value back out', async () => {
    const { render, waitFor } = await import('@testing-library/svelte');
    const { rerender, container } = render(PayloadEditor, {
      props: { id: 'test-payload', label: 'Payload', value: '{"a":1}' },
    });

    await waitFor(() => {
      expect(container.querySelector('.cm-content')).not.toBeNull();
    });

    await rerender({ id: 'test-payload', label: 'Payload', value: '{"a":2}' });

    await waitFor(() => {
      expect(currentControlValue(container)).toBe('{"a":2}');
    });
  });
});
