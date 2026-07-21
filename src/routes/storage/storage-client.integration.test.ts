/**
 * Integration tests for `storage-client.ts` against a REAL in-process weft
 * server (`../../lib/live-source/live-source-test-server.test-support.ts` —
 * see that module's doc comment for why `serve()` isn't used and why this is
 * genuinely engine-backed, not a mock). Proves the wire contract this
 * module's doc comment claims: raw-byte GET/PUT, NDJSON scan with base64
 * values, JSON batch/conditional-batch with base64 values, 404-is-null on a
 * missing GET, and `NotImplemented` → `probeConditionalBatchSupported()`
 * returning the right boolean for `MemoryStorage` (which reports
 * `conditionalBatch: true`).
 */
import { Engine, MemoryStorage, type Storage } from '@lostgradient/weft';
import { HttpClientError } from '@lostgradient/weft/client';
import { principalFromStdioLocal } from '@lostgradient/weft/mcp';
import { handleRequest } from '@lostgradient/weft/server/handler';
import { describe, expect, test } from 'bun:test';

import { startLiveSourceTestServer } from '../../lib/live-source/live-source-test-server.test-support.ts';
import {
  probeConditionalBatchSupported,
  storageBatch,
  storageConditionalBatch,
  storageDelete,
  storageGet,
  storagePut,
  storageScan,
  type StorageConnection,
} from './storage-client.ts';

function connectionFor(baseUrl: string): StorageConnection {
  return { baseUrl, headers: {} };
}

/**
 * A `Storage` that behaves exactly like `MemoryStorage` except it honestly
 * reports no `conditionalBatch` support — mirrors the technique weft's own
 * `storage.test.ts` uses ("A backend that has the bound conditionalBatch
 * method but honestly reports no support — proves the operation gates on
 * capabilities(), not method presence"). Needed to exercise the real 501
 * `probeConditionalBatchSupported()` must detect by HTTP status (see that
 * function's doc comment: `shapeRestFault` never puts a fault code on the
 * wire for storage responses).
 */
function storageWithoutConditionalBatch(): Storage {
  const inner = new MemoryStorage();
  return {
    capabilities: () => ({ ...inner.capabilities(), conditionalBatch: false }),
    get: inner.get.bind(inner),
    put: inner.put.bind(inner),
    delete: inner.delete.bind(inner),
    scan: inner.scan.bind(inner),
    batch: inner.batch.bind(inner),
  } as Storage;
}

/** A minimal `handleRequest`-backed server over a caller-supplied `Storage`, granting every scope (mirrors `startLiveSourceTestServer`'s auth posture, scoped down to just what these tests need). */
function startServerOverStorage(storage: Storage): { baseUrl: string; stop: () => void } {
  const engine = new Engine({ storage });
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      return handleRequest(request, engine, {
        authContext: { method: 'public', principal: principalFromStdioLocal() },
      });
    },
  });
  return {
    baseUrl: server.url.toString().replace(/\/+$/, ''),
    stop: () => server.stop(true),
  };
}

describe('storage-client (integration, real server)', () => {
  test('get returns null for a missing key', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const value = await storageGet(connectionFor(server.baseUrl), 'app:does-not-exist');
      expect(value).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('put then get round-trips raw bytes exactly', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const written = new TextEncoder().encode('{"owner":"ops"}');
      await storagePut(connectionFor(server.baseUrl), 'app:my-service:config', written);

      const read = await storageGet(connectionFor(server.baseUrl), 'app:my-service:config');
      expect(read).not.toBeNull();
      expect(Array.from(read ?? [])).toEqual(Array.from(written));
    } finally {
      server.stop();
    }
  });

  test('put then delete then get returns null', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const connection = connectionFor(server.baseUrl);
      await storagePut(connection, 'app:temp-key', new TextEncoder().encode('x'));
      expect(await storageGet(connection, 'app:temp-key')).not.toBeNull();

      await storageDelete(connection, 'app:temp-key');
      expect(await storageGet(connection, 'app:temp-key')).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('scan returns entries under a prefix with decoded values, and pagination cursor advances via gt', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const connection = connectionFor(server.baseUrl);
      await storagePut(connection, 'app:scan:a', new TextEncoder().encode('1'));
      await storagePut(connection, 'app:scan:b', new TextEncoder().encode('2'));
      await storagePut(connection, 'app:scan:c', new TextEncoder().encode('3'));

      const firstPage = await storageScan(connection, { prefix: 'app:scan:', limit: 2 });
      expect(firstPage.entries.map((entry) => entry.key)).toEqual(['app:scan:a', 'app:scan:b']);
      expect(new TextDecoder().decode(firstPage.entries[0]?.value)).toBe('1');
      expect(firstPage.nextCursor).toBe('app:scan:b');
      if (firstPage.nextCursor === undefined) throw new Error('expected a cursor');

      const secondPage = await storageScan(connection, {
        prefix: 'app:scan:',
        limit: 2,
        gt: firstPage.nextCursor,
      });
      expect(secondPage.entries.map((entry) => entry.key)).toEqual(['app:scan:c']);
      expect(secondPage.nextCursor).toBeUndefined();
    } finally {
      server.stop();
    }
  });

  test('batch applies put and delete operations atomically', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const connection = connectionFor(server.baseUrl);
      await storagePut(connection, 'app:batch:remove-me', new TextEncoder().encode('gone'));

      await storageBatch(connection, [
        { type: 'put', key: 'app:batch:added', value: new TextEncoder().encode('new') },
        { type: 'delete', key: 'app:batch:remove-me' },
      ]);

      expect(await storageGet(connection, 'app:batch:remove-me')).toBeNull();
      const added = await storageGet(connection, 'app:batch:added');
      expect(new TextDecoder().decode(added ?? new Uint8Array())).toBe('new');
    } finally {
      server.stop();
    }
  });

  test('conditionalBatch applies when the expected value matches and rejects (applied: false) when it does not', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const connection = connectionFor(server.baseUrl);
      await storagePut(connection, 'app:cas:key', new TextEncoder().encode('before'));

      const staleResult = await storageConditionalBatch(
        connection,
        [{ key: 'app:cas:key', expectedValue: new TextEncoder().encode('wrong-expectation') }],
        [{ type: 'put', key: 'app:cas:key', value: new TextEncoder().encode('after') }],
      );
      expect(staleResult.applied).toBe(false);
      expect(
        new TextDecoder().decode((await storageGet(connection, 'app:cas:key')) ?? new Uint8Array()),
      ).toBe('before');

      const freshResult = await storageConditionalBatch(
        connection,
        [{ key: 'app:cas:key', expectedValue: new TextEncoder().encode('before') }],
        [{ type: 'put', key: 'app:cas:key', value: new TextEncoder().encode('after') }],
      );
      expect(freshResult.applied).toBe(true);
      expect(
        new TextDecoder().decode((await storageGet(connection, 'app:cas:key')) ?? new Uint8Array()),
      ).toBe('after');
    } finally {
      server.stop();
    }
  });

  test('probeConditionalBatchSupported returns true against MemoryStorage without writing anything', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const connection = connectionFor(server.baseUrl);
      const before = await storageScan(connection, { prefix: '', limit: 10_000 });

      const supported = await probeConditionalBatchSupported(connection);
      expect(supported).toBe(true);

      const after = await storageScan(connection, { prefix: '', limit: 10_000 });
      expect(after.entries.map((entry) => entry.key)).toEqual(
        before.entries.map((entry) => entry.key),
      );
    } finally {
      server.stop();
    }
  });

  test('probeConditionalBatchSupported returns false when the backend reports conditionalBatch: false, without throwing', async () => {
    const server = startServerOverStorage(storageWithoutConditionalBatch());
    try {
      const supported = await probeConditionalBatchSupported(connectionFor(server.baseUrl));
      expect(supported).toBe(false);
    } finally {
      server.stop();
    }
  });

  test('conditionalBatch on an unsupported backend rejects with HttpClientError status 501', async () => {
    const server = startServerOverStorage(storageWithoutConditionalBatch());
    try {
      const connection = connectionFor(server.baseUrl);
      const rejection = storageConditionalBatch(
        connection,
        [],
        [{ type: 'put', key: 'app:x', value: new TextEncoder().encode('y') }],
      );
      await expect(rejection).rejects.toBeInstanceOf(HttpClientError);
      await expect(rejection).rejects.toMatchObject({ status: 501 });
    } finally {
      server.stop();
    }
  });
});
