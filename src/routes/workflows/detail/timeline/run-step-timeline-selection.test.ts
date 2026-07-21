import { describe, expect, test } from 'bun:test';

import {
  applyRunStepTimelineDivergenceHighlight,
  applyRunStepTimelineSelectionHighlight,
  attachRunStepTimelineClickSelection,
} from './run-step-timeline-selection.ts';

/**
 * happy-dom's `EventTarget.dispatchEvent` does an internal `instanceof
 * Event` check against the SAME window's `Event` class — the bare global
 * `Event` constructor is a different reference under this repo's test setup
 * (`tests/setup.ts`'s "skip if already present" global copy) and fails that
 * check with a confusing `TypeError`. Same workaround as
 * `live-source/polling-source.test.ts`.
 */
function dispatchClick(target: EventTarget): void {
  const HappyDomEvent = (window as unknown as { Event: typeof Event }).Event;
  target.dispatchEvent(new HappyDomEvent('click', { bubbles: true }));
}

/** Builds a minimal DOM tree shaped like Cinder's `RunStepTimeline` render output. */
function buildTimelineDom(stepPaths: readonly string[]): HTMLElement {
  const container = document.createElement('div');
  const list = document.createElement('ol');
  for (const path of stepPaths) {
    const item = document.createElement('li');
    item.className = 'cinder-run-step-timeline__item';
    item.setAttribute('data-cinder-path', path);
    const label = document.createElement('span');
    label.className = 'cinder-run-step-timeline__label';
    label.textContent = path;
    item.append(label);
    list.append(item);
  }
  container.append(list);
  return container;
}

describe('attachRunStepTimelineClickSelection', () => {
  test('clicking anywhere inside a step row reports its step id', () => {
    const container = buildTimelineDom(['step-1', 'step-2']);
    const selected: string[] = [];
    attachRunStepTimelineClickSelection(container, (id) => selected.push(id));

    const label = container.querySelector('[data-cinder-path="step-2"] .cinder-run-step-timeline__label');
    dispatchClick(label as EventTarget);

    expect(selected).toEqual(['step-2']);
  });

  test('clicking outside any recognized row is a no-op', () => {
    const container = buildTimelineDom(['step-1']);
    const selected: string[] = [];
    attachRunStepTimelineClickSelection(container, (id) => selected.push(id));

    dispatchClick(container);

    expect(selected).toEqual([]);
  });

  test('a path this module did not mint (e.g. an unrecognized nested/lane path) is ignored', () => {
    const container = buildTimelineDom(['%branch/race']);
    const selected: string[] = [];
    attachRunStepTimelineClickSelection(container, (id) => selected.push(id));

    dispatchClick(container.querySelector('[data-cinder-path]') as EventTarget);

    expect(selected).toEqual([]);
  });

  test('cleanup removes the listener', () => {
    const container = buildTimelineDom(['step-1']);
    const selected: string[] = [];
    const cleanup = attachRunStepTimelineClickSelection(container, (id) => selected.push(id));
    cleanup();

    dispatchClick(container.querySelector('[data-cinder-path]') as EventTarget);

    expect(selected).toEqual([]);
  });
});

describe('applyRunStepTimelineSelectionHighlight', () => {
  test('marks exactly the selected row', () => {
    const container = buildTimelineDom(['step-1', 'step-2']);
    applyRunStepTimelineSelectionHighlight(container, 'step-2');

    expect(container.querySelector('[data-cinder-path="step-1"]')?.hasAttribute('data-weft-timeline-selected')).toBe(
      false,
    );
    expect(container.querySelector('[data-cinder-path="step-2"]')?.hasAttribute('data-weft-timeline-selected')).toBe(
      true,
    );
  });

  test('clearing the selection removes the attribute from every row', () => {
    const container = buildTimelineDom(['step-1']);
    applyRunStepTimelineSelectionHighlight(container, 'step-1');
    applyRunStepTimelineSelectionHighlight(container, null);

    expect(container.querySelector('[data-cinder-path="step-1"]')?.hasAttribute('data-weft-timeline-selected')).toBe(
      false,
    );
  });

  test('re-applying moves the attribute rather than stacking it', () => {
    const container = buildTimelineDom(['step-1', 'step-2']);
    applyRunStepTimelineSelectionHighlight(container, 'step-1');
    applyRunStepTimelineSelectionHighlight(container, 'step-2');

    expect(container.querySelectorAll('[data-weft-timeline-selected]')).toHaveLength(1);
    expect(container.querySelector('[data-cinder-path="step-2"]')?.hasAttribute('data-weft-timeline-selected')).toBe(
      true,
    );
  });
});

describe('applyRunStepTimelineDivergenceHighlight', () => {
  test('marks every row whose step id is in the diverged set', () => {
    const container = buildTimelineDom(['step-1', 'step-2', 'step-3']);
    applyRunStepTimelineDivergenceHighlight(container, new Set(['step-2', 'step-3']));

    expect(container.querySelector('[data-cinder-path="step-1"]')?.hasAttribute('data-weft-timeline-diverged')).toBe(
      false,
    );
    expect(container.querySelector('[data-cinder-path="step-2"]')?.hasAttribute('data-weft-timeline-diverged')).toBe(
      true,
    );
    expect(container.querySelector('[data-cinder-path="step-3"]')?.hasAttribute('data-weft-timeline-diverged')).toBe(
      true,
    );
  });

  test('uses a distinct attribute from the selection highlight — the two never collide', () => {
    const container = buildTimelineDom(['step-1']);
    applyRunStepTimelineSelectionHighlight(container, 'step-1');
    applyRunStepTimelineDivergenceHighlight(container, new Set(['step-1']));

    const item = container.querySelector('[data-cinder-path="step-1"]');
    expect(item?.hasAttribute('data-weft-timeline-selected')).toBe(true);
    expect(item?.hasAttribute('data-weft-timeline-diverged')).toBe(true);
  });
});
