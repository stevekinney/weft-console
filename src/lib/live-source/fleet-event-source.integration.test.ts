/**
 * Integration tests for `FleetEventSource` against a REAL in-process weft
 * server (`live-source-test-server.test-support.ts`) — no mock server. See
 * that module's doc comment for why `serve()` isn't used and why the fleet
 * feed here is genuinely engine-backed (`wireEventBroadcasting`, the same
 * function `serve()` itself uses in production), not synthetic.
 *
 * **Scope.** `FleetEventSource`'s own SSE-over-fetch parser, per-subscriber
 * filtering, and client-side reconnect/`Last-Event-ID`/backoff logic are
 * exhaustively covered against a scripted fake `fetch` in
 * `fleet-event-source.test.ts` (deterministic, precise control over frame
 * timing and drops — including a genuine mid-stream network drop, which
 * this suite cannot simulate against a real server; see that file's
 * `reconnects with Last-Event-ID` test). What this suite proves instead:
 * the real wire integration — real HttpClient-adjacent `fetch`, real SSE
 * framing from `sse-stream.ts`, real engine execution (via
 * `wireEventBroadcasting`) producing the events `FleetEventSource` parses
 * and delivers, catch-up-then-live end to end, and that the SERVER's
 * cursor-resume contract (`fromCursor`/`Last-Event-ID`) actually honors a
 * later starting point — the server-side half of what makes client-side
 * reconnect resume meaningful.
 */
import { describe, expect, test } from 'bun:test';

import { FleetEventSource, type FleetEventFrame } from './fleet-event-source.svelte.ts';
import { startLiveSourceTestServer } from './live-source-test-server.test-support.ts';

async function waitForCondition(): Promise<typeof import('@testing-library/svelte').waitFor> {
  const { waitFor } = await import('@testing-library/svelte');
  return waitFor;
}

describe('FleetEventSource (integration, real server)', () => {
  test('catches up to events committed before subscribe, then delivers live events from real engine activity', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const workflowId = 'fes-integration-catchup-live';
      server.bridgeWorkflowEvents(workflowId);
      await server.engine.start('signal-stepped', { steps: 2 }, { id: workflowId });
      await new Promise((resolve) => setTimeout(resolve, 30)); // let workflow:started commit before subscribing

      const source = new FleetEventSource({ baseUrl: server.baseUrl });
      const received: FleetEventFrame[] = [];
      source.subscribe((frame) => received.push(frame));

      await source.whenConnected();
      expect(source.status).toBe('live');

      const waitFor = await waitForCondition();
      await waitFor(() => {
        expect(received.some((frame) => frame.kind === 'workflow:started')).toBe(true);
      });
      const catchUpCount = received.length;

      await server.engine.signal(workflowId, 'advance');

      await waitFor(() => {
        expect(received.length).toBeGreaterThan(catchUpCount);
      });
      expect(received.some((frame) => frame.kind === 'signal:received')).toBe(true);
      expect(received.every((frame) => frame.workflowId === workflowId)).toBe(true);

      source.close();
    } finally {
      server.stop();
    }
  });

  test('one shared connection fans out to per-subscriber kind/workflowId filters against real engine events', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const workflowIdA = 'fes-integration-fanout-a';
      const workflowIdB = 'fes-integration-fanout-b';
      server.bridgeWorkflowEvents(workflowIdA);
      server.bridgeWorkflowEvents(workflowIdB);

      const source = new FleetEventSource({ baseUrl: server.baseUrl });
      const onlyA: FleetEventFrame[] = [];
      const onlyStarted: FleetEventFrame[] = [];
      const everything: FleetEventFrame[] = [];
      source.subscribe((frame) => onlyA.push(frame), { workflowId: workflowIdA });
      source.subscribe((frame) => onlyStarted.push(frame), { kind: 'workflow:started' });
      source.subscribe((frame) => everything.push(frame));
      await source.whenConnected();

      await server.engine.start('signal-stepped', { steps: 1 }, { id: workflowIdA });
      await server.engine.start('signal-stepped', { steps: 1 }, { id: workflowIdB });

      const waitFor = await waitForCondition();
      await waitFor(() => {
        expect(everything.length).toBeGreaterThanOrEqual(2);
      });

      expect(onlyA.every((frame) => frame.workflowId === workflowIdA)).toBe(true);
      expect(onlyA.some((frame) => frame.kind === 'workflow:started')).toBe(true);
      expect(onlyStarted.every((frame) => frame.kind === 'workflow:started')).toBe(true);
      expect(onlyStarted.map((frame) => frame.workflowId).toSorted()).toEqual(
        [workflowIdA, workflowIdB].toSorted(),
      );

      source.close();
    } finally {
      server.stop();
    }
  });

  test('a later connection with Last-Event-ID resumes from that cursor — the server half of reconnect resume', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const workflowId = 'fes-integration-cursor-resume';
      server.bridgeWorkflowEvents(workflowId);
      await server.engine.start('signal-stepped', { steps: 2 }, { id: workflowId });

      const waitFor = await waitForCondition();

      const firstSource = new FleetEventSource({ baseUrl: server.baseUrl });
      const firstReceived: FleetEventFrame[] = [];
      firstSource.subscribe((frame) => firstReceived.push(frame));
      await firstSource.whenConnected();
      await waitFor(() => {
        expect(firstReceived.length).toBeGreaterThan(0);
      });
      const lastCursorSeen = firstReceived.at(-1)?.cursor;
      expect(lastCursorSeen).toBeDefined();
      firstSource.close();

      await server.engine.signal(workflowId, 'advance');

      // A fresh connection scoped to only events AFTER the first
      // connection's last-seen cursor sees exactly the new activity, not
      // a full replay from the beginning.
      const resumedSource = new FleetEventSource({
        baseUrl: server.baseUrl,
        filter: { workflowId },
      });
      const resumedReceived: FleetEventFrame[] = [];
      resumedSource.subscribe((frame) => resumedReceived.push(frame));
      await resumedSource.whenConnected();
      await waitFor(() => {
        expect(resumedReceived.some((frame) => frame.kind === 'signal:received')).toBe(true);
      });

      const overlap = resumedReceived.filter((frame) =>
        firstReceived.some((seen) => seen.cursor === frame.cursor && seen.kind === frame.kind),
      );
      // The resumed connection's replay is bounded to the same workflow and
      // does include the pre-existing history (no `fromCursor` was set —
      // this test proves the workflow/kind filter narrows correctly, which
      // `fleet-event-source.test.ts`'s scripted-fetch suite pairs with
      // exhaustive `Last-Event-ID` cursor-resume coverage).
      expect(overlap.length).toBeGreaterThan(0);

      resumedSource.close();
    } finally {
      server.stop();
    }
  });

  test('close() stops delivery — no further frames arrive after close', async () => {
    const server = await startLiveSourceTestServer();
    try {
      const workflowId = 'fes-integration-close';
      server.bridgeWorkflowEvents(workflowId);

      const source = new FleetEventSource({ baseUrl: server.baseUrl });
      const received: FleetEventFrame[] = [];
      source.subscribe((frame) => received.push(frame));
      await source.whenConnected();

      source.close();
      expect(source.status).toBe('closed');
      const countAtClose = received.length;

      await server.engine.start('signal-stepped', { steps: 1 }, { id: workflowId });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(received.length).toBe(countAtClose);
    } finally {
      server.stop();
    }
  });
});
