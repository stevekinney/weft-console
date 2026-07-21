/**
 * Test-only support module (never imported by production code — see
 * `weft`'s own `.test-support.ts` convention). Re-exports
 * `InMemorySequencedFeed` under this module's established test-facing name
 * — used to inject a real, engine-independent `workflowEventFeed`/
 * `fleetEventFeed` into `HandlerOptions` for the T1.4 integration tests.
 *
 * **Why this is not a mock server.** `HandlerOptions.workflowEventFeed` /
 * `.fleetEventFeed` are real, documented extension points `handleRequest`
 * accepts (see `weft/src/server/handler/route-dispatch.ts`) — the SAME
 * pattern weft's own `src/server/operations/fleet-events-sse.test.ts` uses
 * (`RecordingFleetEventFeed`). The REST binding, the SSE byte-stream
 * encoder, and auth/scope gating all stay real; only the feed's data
 * source is a double. `createEngineEventFeedBackend`/`createWorkflowEventFeed`/
 * `createFleetEventFeed` (weft's real, engine-backed constructors for these
 * same interfaces) are not exported from any public subpath — filed as
 * https://github.com/stevekinney/weft/issues/714 — so this is also the
 * only way to drive these routes through `handleRequest` at all today.
 *
 * The feed implementation itself lives in `in-memory-sequenced-feed.ts`
 * (a plain, non-test-support module) rather than here, so
 * `scripts/dev-server.ts` — the real (non-test) dev harness, which wires
 * the SAME `fleetEventFeed` extension point against genuine engine events —
 * can depend on it without importing a module whose name promises "tests
 * only".
 */
export {
  encodeSequencedFeedCursor as encodeTestCursor,
  InMemorySequencedFeed,
} from './in-memory-sequenced-feed.ts';
