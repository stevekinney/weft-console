/**
 * Unit tests for `dead-letter-request.ts` against a stubbed `fetch` —
 * proves URL construction, method, header forwarding, and error
 * classification without a real server. See
 * `dead-letter-request.integration.test.ts` for the real-server round trip.
 */
import { HttpClientError } from '@lostgradient/weft/client';
import { afterEach, describe, expect, test } from 'bun:test';

import { clearDeadLetter } from './dead-letter-request.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (request: Request) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return handler(request);
  }) as typeof fetch;
}

describe('clearDeadLetter', () => {
  test('DELETEs the encoded operationId path with the client headers', async () => {
    let capturedRequest: Request | undefined;
    stubFetch((request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    await clearDeadLetter(
      { baseUrl: 'https://weft.example.com', headers: { Authorization: 'Bearer t' } },
      'op with spaces/1',
    );

    expect(capturedRequest?.url).toBe(
      'https://weft.example.com/v1/tasks/diagnostics/dead-letter/op%20with%20spaces%2F1',
    );
    expect(capturedRequest?.method).toBe('DELETE');
    expect(capturedRequest?.headers.get('authorization')).toBe('Bearer t');
  });

  test('resolves without throwing on a 200 response', async () => {
    stubFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(
      clearDeadLetter({ baseUrl: 'https://weft.example.com', headers: {} }, 'op-1'),
    ).resolves.toBeUndefined();
  });

  test('throws HttpClientError with the flat error message on a non-ok response', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: 'Task not found in dead-letter storage: op-1' }), {
          status: 404,
        }),
    );

    const error = await clearDeadLetter(
      { baseUrl: 'https://weft.example.com', headers: {} },
      'op-1',
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpClientError);
    expect((error as HttpClientError).status).toBe(404);
    expect((error as HttpClientError).message).toBe('Task not found in dead-letter storage: op-1');
    // Mirrors `shapeRestFault`'s flat body (no `code` field) — no faultCode
    // should be attached, so `classifyFault` falls back to status-based
    // treatment rather than misreading a structured fault shape.
    expect((error as HttpClientError).faultCode).toBeUndefined();
  });

  test('falls back to statusText when the error body is not JSON', async () => {
    stubFetch(() => new Response('not json', { status: 403, statusText: 'Forbidden' }));

    const error = await clearDeadLetter(
      { baseUrl: 'https://weft.example.com', headers: {} },
      'op-1',
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpClientError);
    expect((error as HttpClientError).status).toBe(403);
    expect((error as HttpClientError).message).toBe('Forbidden');
  });

  test('falls back to statusText when the error body has no string `error` field', async () => {
    stubFetch(() => new Response(JSON.stringify({ weftCode: 'X' }), { status: 500 }));

    const error = await clearDeadLetter(
      { baseUrl: 'https://weft.example.com', headers: {} },
      'op-1',
    ).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HttpClientError);
    expect((error as HttpClientError).status).toBe(500);
  });
});
