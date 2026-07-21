/**
 * `weft.tasks.diagnostics.deadletters.clear` request (plan §9.4 T5.3, Tier-3
 * dead-letter clear action).
 *
 * ## Why this isn't a plain `client.operations[...]` call
 *
 * This operation is deliberately REST-only
 * (`transports: { http: true, jsonRpcHttp: false, jsonRpcWebSocket: false,
 * jsonRpcStdio: false }`, `weft/src/server/operations/get-task-diagnostics.ts`),
 * so it never appears in `CATALOG_OPERATION_NAMES`
 * (`scripts/generate-operation-client.ts` filters the generated client to
 * `transports.jsonRpcHttp` operations only) — `HttpClient.operations` /
 * `.call()` are JSON-RPC-only and cannot reach it at all; referencing
 * `client.operations['weft.tasks.diagnostics.deadletters.clear']` is a
 * compile error. Filed upstream: https://github.com/stevekinney/weft/issues/728
 * (same root cause as #725, which the Storage track hit independently for
 * `weft.storage.*` — both filed against the same generator filter).
 *
 * ## Why this is not the "never fetch() the API directly" rule
 *
 * `clearDeadLetter()` below still goes through the app's one `HttpClient`
 * instance's own resolved connection — `client.baseUrl`/`client.headers`
 * (both public `readonly` fields `HttpClient` already exposes and uses for
 * its own internal `request()` helper), rather than hand-rolling a new base
 * URL or auth story. It is the smallest workaround for the one operation
 * the typed surface cannot reach; every other read/write on this track goes
 * through `client.operations`/`getClient()` as normal.
 *
 * `readErrorMessage()` mirrors the relevant slice of `HttpClient`'s own
 * `parseErrorBody()` (`weft/src/client/http-request.ts`) — not the whole
 * function, since this route's error shape is fixed:
 * `clearTaskDeadLetterRestBinding.shapeFault` is `shapeRestFault`
 * (`weft/src/server/operations/operation-helpers.ts`), which always returns
 * a flat `{ error: string }` body with no `faultCode`. Constructing a real
 * `HttpClientError` from it means the result classifies through
 * `../../lib/faults.ts` exactly like every other client error — a 404
 * (already cleared) or 403 (missing `system:admin`) renders its real
 * treatment instead of collapsing to a generic "something went wrong".
 */
import { HttpClientError, type HttpClient } from '@lostgradient/weft/client';

type DeadLetterClient = Pick<HttpClient, 'baseUrl' | 'headers'>;

function isFlatErrorBody(value: unknown): value is { readonly error?: unknown } {
  return typeof value === 'object' && value !== null;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (isFlatErrorBody(body) && typeof body.error === 'string') return body.error;
  } catch {
    // A non-JSON or empty body isn't itself an error worth surfacing over
    // the HTTP status text below.
  }
  return response.statusText;
}

/**
 * Clears one dead-lettered task-result record by `operationId`
 * (`DELETE /v1/tasks/diagnostics/dead-letter/:operationId`, `system:admin`).
 * Throws `HttpClientError` on a non-2xx response.
 */
export async function clearDeadLetter(
  client: DeadLetterClient,
  operationId: string,
): Promise<void> {
  const url = `${client.baseUrl}/v1/tasks/diagnostics/dead-letter/${encodeURIComponent(operationId)}`;
  const response = await fetch(url, { method: 'DELETE', headers: client.headers });
  if (!response.ok) {
    throw new HttpClientError(response.status, await readErrorMessage(response));
  }
}
