/**
 * Integration test for `clearDeadLetter()` against a REAL in-process weft
 * server (`../../lib/live-source/live-source-test-server.test-support.ts`,
 * a plain `serve()` as of `@lostgradient/weft@0.12.0`). `DELETE
 * /v1/tasks/diagnostics/dead-letter/:operationId` is plain REST over
 * `engine.storage`, so this test needs no `WorkerRegistry`/`TaskQueue` state
 * either way — `weft.workers.list`/`weft.task.queues.list` (JSON-RPC,
 * backed by the real `WeftServer.registry`/`.taskQueue` a real `serve()`
 * instance constructs) are reachable through this harness now too, but
 * nothing here exercises them.
 *
 * Weft 0.20 moved dead letters into its private durable task ledger. This
 * test deliberately stays on the public REST contract rather than copying
 * or importing that private persistence shape; successful DELETE behavior
 * remains covered by `dead-letter-request.test.ts` and the route mutation
 * component test.
 */
import { HttpClientError } from '@lostgradient/weft/client';
import { describe, expect, test } from 'bun:test';

import {
  startLiveSourceTestServer,
  type LiveSourceTestServer,
} from '../../lib/live-source/live-source-test-server.test-support.ts';
import { clearDeadLetter } from './dead-letter-request.ts';

/** `weft.tasks.diagnostics.deadletters.clear` declares `access: { kind: 'scoped', scopes: { anyOf: ['system:admin'] } }` — an anonymous request 401s. */
function authorizedHeaders(server: LiveSourceTestServer): Record<string, string> {
  return { Authorization: `Bearer ${server.token}` };
}

describe('clearDeadLetter (integration, real server)', () => {
  test('returns the real server NotFound fault when the task ledger has no dead letter', async () => {
    const server = await startLiveSourceTestServer();

    try {
      const error = await clearDeadLetter(
        { baseUrl: server.baseUrl, headers: authorizedHeaders(server) },
        'never-existed',
      ).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(HttpClientError);
      expect((error as HttpClientError).status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  test('enforces the real server system:admin permission boundary', async () => {
    const server = await startLiveSourceTestServer();

    try {
      const error = await clearDeadLetter(
        { baseUrl: server.baseUrl, headers: {} },
        'never-existed',
      ).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(HttpClientError);
      expect((error as HttpClientError).status).toBe(401);
    } finally {
      await server.stop();
    }
  });
});
