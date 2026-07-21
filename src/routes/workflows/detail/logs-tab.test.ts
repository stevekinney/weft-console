import { describe, expect, test } from 'bun:test';

import LogsTab from './logs-tab.svelte';

describe('LogsTab', () => {
  test('renders an honest empty state naming the gap rather than fake data', async () => {
    const { render } = await import('@testing-library/svelte');
    const { getByText } = render(LogsTab);

    expect(getByText("Logs aren't available yet")).not.toBeNull();
    expect(getByText(/EngineOptions.onLog/)).not.toBeNull();
  });
});
