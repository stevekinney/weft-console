/**
 * Integration test for `clearDeadLetter()` against a REAL in-process weft
 * server (`../../lib/live-source/live-source-test-server.test-support.ts`).
 * This is the one worker-surface data path that genuinely round-trips
 * through the dev/test harness — `DELETE /v1/tasks/diagnostics/dead-letter/
 * :operationId` is plain REST over `engine.storage`, with no `WorkerRegistry`/
 * `TaskQueue` dependency (unlike `weft.workers.list`/`weft.task.queues.list`,
 * which are unreachable under `handleRequest` per
 * https://github.com/stevekinney/weft/issues/729).
 *
 * Seeds a real `DeadLetteredTaskRecord` directly into `engine.storage` (the
 * same key/encoding the server's own `get-task-diagnostics.ts` reads),
 * mirroring the technique `storage-client.integration.test.ts` and
 * `live-source-test-server.test-support.ts` itself establish for this repo:
 * write through the engine's real storage, never a mock server.
 */
import { encode } from '@lostgradient/weft';
import { KEYS } from '@lostgradient/weft/storage/interface';
import { describe, expect, test } from 'bun:test';

import { startLiveSourceTestServer } from '../../lib/live-source/live-source-test-server.test-support.ts';
import { clearDeadLetter } from './dead-letter-request.ts';

interface DeadLetteredTaskRecordLike {
  readonly operationId: string;
  readonly reason: 'result-resolution-storage-exhausted';
  readonly deadLetteredAt: number;
  readonly errorMessage: string;
  readonly retryAttempts: number;
  readonly status: 'failed';
}

async function seedDeadLetter(
  storage: { put(key: string, value: Uint8Array): Promise<void> },
  operationId: string,
): Promise<void> {
  const record: DeadLetteredTaskRecordLike = {
    operationId,
    reason: 'result-resolution-storage-exhausted',
    deadLetteredAt: Date.now(),
    errorMessage: 'storage exhausted',
    retryAttempts: 5,
    status: 'failed',
  };
  await storage.put(KEYS.operationDeadLetter(operationId), encode(record));
}

describe('clearDeadLetter (integration, real server)', () => {
  test('clears a real seeded dead-letter record, and the record is actually gone from storage afterward', async () => {
    const server = await startLiveSourceTestServer();
    const operationId = 'dead-letter-integration-op-1';

    try {
      await seedDeadLetter(server.engine.storage, operationId);
      expect(await server.engine.storage.get(KEYS.operationDeadLetter(operationId))).not.toBeNull();

      await expect(
        clearDeadLetter({ baseUrl: server.baseUrl, headers: {} }, operationId),
      ).resolves.toBeUndefined();

      expect(await server.engine.storage.get(KEYS.operationDeadLetter(operationId))).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('clearing an operationId with no dead-letter record is a no-op success, not a NotFound fault (unconditional delete, `producibleFaults: []` on the server operation)', async () => {
    const server = await startLiveSourceTestServer();

    try {
      await expect(
        clearDeadLetter({ baseUrl: server.baseUrl, headers: {} }, 'never-existed'),
      ).resolves.toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test('two seeded records are cleared independently — clearing one leaves the other', async () => {
    const server = await startLiveSourceTestServer();

    try {
      await seedDeadLetter(server.engine.storage, 'dead-letter-op-a');
      await seedDeadLetter(server.engine.storage, 'dead-letter-op-b');

      await clearDeadLetter({ baseUrl: server.baseUrl, headers: {} }, 'dead-letter-op-a');

      expect(
        await server.engine.storage.get(KEYS.operationDeadLetter('dead-letter-op-a')),
      ).toBeNull();
      expect(
        await server.engine.storage.get(KEYS.operationDeadLetter('dead-letter-op-b')),
      ).not.toBeNull();
    } finally {
      server.stop();
    }
  });
});
