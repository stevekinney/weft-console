import { render } from '@testing-library/svelte';
import { describe, expect, test } from 'bun:test';

import TaskLedgerDetailView from './task-ledger-detail-view.svelte';
import { parseTaskLedgerDetail } from './workers-data.ts';

const NOW = 1_700_000_000_000;

function queuedTask() {
  return {
    state: 'queued',
    operationId: 'op_ledger_123456789',
    workflowId: 'wf_1',
    workflowExecutionToken: 'token_1',
    workflowType: 'orders',
    activityName: 'chargeCard',
    queue: 'payments',
    priority: 7,
    headerKeys: ['traceparent', 'tenant-id'],
    visibilityTimeoutMilliseconds: 30_000,
    retryPolicy: {
      maxAttempts: 5,
      initialBackoff: '1s',
      backoffMultiplier: 2,
      maxBackoff: '1m',
    },
    executionRequirement: { deploymentName: 'payments-v2', buildId: 'build-42' },
    createdAt: NOW - 60_000,
    availableAt: NOW + 30_000,
    attempt: 2,
    retryCount: 1,
    requeueCount: 1,
  } as const;
}

describe('task ledger response validation', () => {
  test('accepts the published common ledger envelope', () => {
    expect(parseTaskLedgerDetail(queuedTask())).toEqual(queuedTask());
  });

  test('rejects malformed generated-operation output at the boundary', () => {
    expect(() => parseTaskLedgerDetail({ state: 'queued', operationId: 'op_bad' })).toThrow(
      'malformed task ledger response',
    );
  });
});

describe('TaskLedgerDetailView', () => {
  test('renders one state with attempt, dispatch, retry, and reservation evidence', () => {
    const { getByText } = render(TaskLedgerDetailView, {
      props: { task: parseTaskLedgerDetail(queuedTask()), now: NOW },
    });

    expect(getByText('Delayed')).not.toBeNull();
    expect(getByText('traceparent, tenant-id')).not.toBeNull();
    expect(getByText('Available · attempt 2 of 5')).not.toBeNull();
    expect(getByText(/deploymentName: payments-v2/)).not.toBeNull();
  });

  test('makes failed adoption and retained terminal evidence explicit', () => {
    const task = parseTaskLedgerDetail({
      ...queuedTask(),
      state: 'terminal',
      disposition: 'resolved',
      resultDigest: 'sha256:abc',
      resultStatus: 'completed',
      terminalAt: NOW - 10_000,
      adopted: false,
    });
    const { getByText } = render(TaskLedgerDetailView, { props: { task, now: NOW } });

    expect(getByText(/has not been adopted/)).not.toBeNull();
    expect(getByText('Awaiting workflow adoption')).not.toBeNull();
    expect(getByText(/Terminal record retained/)).not.toBeNull();
  });
});
