/**
 * Test-only support for the Workers route root (`index.svelte`): a scripted
 * `globalThis.fetch` plus a real `HttpClient` pointed at it, so a component
 * test can drive `index.svelte` against canned JSON-RPC responses without a
 * live server. Mirrors the `ScriptedFetch`/`realClient` pattern already
 * established independently per-track (`src/lib/live-source/fleet-event-source.test.ts`,
 * `src/routes/system/system-test-support.test-support.ts`,
 * `src/routes/dashboard/dashboard-test-support.test-support.ts`,
 * `src/routes/workflows/list/workflow-test-support.test-support.ts`) rather
 * than importing another track's copy across the owned-paths boundary.
 */
import { HttpClient } from '@lostgradient/weft/client';

export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

interface RouteRule {
  readonly matches: (call: FetchCall) => boolean;
  readonly respond: (call: FetchCall) => Response;
}

function parsedJsonRpcMethod(call: FetchCall): string | undefined {
  if (typeof call.init?.body !== 'string') return undefined;
  try {
    return (JSON.parse(call.init.body) as { method?: string }).method;
  } catch {
    return undefined;
  }
}

export class ScriptedFetch {
  readonly calls: FetchCall[] = [];
  readonly #routes: RouteRule[] = [];
  readonly #original: typeof fetch;

  constructor() {
    this.#original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const call: FetchCall = { url, init };
      this.calls.push(call);

      const route = this.#routes.findLast((candidate) => candidate.matches(call));
      if (route) return route.respond(call);

      throw new Error(`ScriptedFetch: no route registered for ${url}`);
    }) as typeof fetch;
  }

  /** Standing route: any JSON-RPC request for `method` gets `result` as a success envelope. */
  routeJsonRpcMethod(method: string, result: unknown): void {
    this.#routes.push({
      matches: (call) => parsedJsonRpcMethod(call) === method,
      respond: () => Response.json({ jsonrpc: '2.0', id: 1, result }),
    });
  }

  /**
   * Standing route: any JSON-RPC request for `method` gets a JSON-RPC error
   * envelope back, in the exact shape `httpClientCatalogTransport` (`weft/src/client/http-operations.ts`)
   * decodes into an `HttpClientError` — `error.data.httpStatus`/`.weftCode`
   * carry the coarse status/fault code (the JSON-RPC transport always
   * responds HTTP 200, even for operation faults; the true status lives in
   * the envelope, not `response.status`).
   */
  routeJsonRpcMethodError(
    method: string,
    httpStatus: number,
    message: string,
    weftCode?: string,
  ): void {
    this.#routes.push({
      matches: (call) => parsedJsonRpcMethod(call) === method,
      respond: () =>
        Response.json({
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32000,
            message,
            data: { httpStatus, ...(weftCode !== undefined ? { weftCode } : {}) },
          },
        }),
    });
  }

  restore(): void {
    globalThis.fetch = this.#original;
  }
}

/** A real `HttpClient` instance for component tests that call `client.operations[...]` — pair with `ScriptedFetch` to script its responses. */
export function realClient(baseUrl = 'http://weft.test/api'): HttpClient {
  return new HttpClient({ baseUrl });
}
