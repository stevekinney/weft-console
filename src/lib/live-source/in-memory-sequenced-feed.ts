/**
 * In-memory replay-then-live sequenced feed. Cursor format mirrors weft's
 * own opaque cursor exactly (`String(sequence)`, `-1` sentinel — see
 * `weft/src/server/workflow-event-feed.ts`'s `encodeCursor`/`decodeCursor`),
 * so cursors this feed emits pass the real server's cursor validation.
 *
 * This backs `HandlerOptions.fleetEventFeed`/`.workflowEventFeed` — real,
 * documented extension points `handleRequest` accepts (see
 * `weft/src/server/handler/route-dispatch.ts`) whenever the engine-backed
 * constructors for those shapes (`createFleetEventFeed`,
 * `createWorkflowEventFeed`) aren't available (they're not exported from any
 * public `@lostgradient/weft` subpath — filed as
 * https://github.com/stevekinney/weft/issues/714). Two callers share this
 * module: `scripts/dev-server.ts` (T0.3's real dev harness — wires the fleet
 * feed genuinely, not synthetically, over real engine events) and
 * `live-source-test-server.test-support.ts` (T1.4's integration-test
 * harness). Extracted out of that `.test-support.ts` file specifically so a
 * non-test script can depend on it without importing a module whose name
 * promises "tests only".
 */

export interface SequencedEnvelope {
  readonly sequence: number;
  readonly cursor: string;
}

export interface SequencedFeedSubscribeOptions<TEnvelope> {
  readonly fromCursor?: string;
  readonly signal?: AbortSignal;
  readonly replayLimit?: number;
  readonly filterEnvelope?: (envelope: TEnvelope) => boolean;
  readonly onReplayComplete?: () => void;
  readonly createReplayLimitError?: (count: number, limit: number) => unknown;
}

/** `-1` (before the first event) or a non-negative integer sequence. */
export function encodeSequencedFeedCursor(sequence: number): string {
  return String(sequence);
}

function decodeSequencedFeedCursor(cursor: string | undefined): number {
  if (cursor === undefined) return -1;
  const value = Number(cursor);
  return Number.isSafeInteger(value) ? value : -1;
}

interface LiveQueueHandle<TEnvelope> {
  readonly queue: TEnvelope[];
  waitForNext(signal: AbortSignal | undefined): Promise<void>;
  unregister(): void;
}

/**
 * `append()` is the caller's hand on the dial — call it whenever a new event
 * arrives (from a real engine listener or, in tests, directly). Supports
 * multiple concurrent `subscribe()` calls, each with its own independent
 * live queue and waker (not a shared per-instance one — a shared waker would
 * let a second concurrent subscription silently steal wake-ups from the
 * first).
 */
export class InMemorySequencedFeed<TEnvelope extends SequencedEnvelope> {
  readonly #stored: TEnvelope[] = [];
  readonly #liveListeners = new Set<(envelope: TEnvelope) => void>();

  append(envelope: TEnvelope): void {
    this.#stored.push(envelope);
    for (const listener of this.#liveListeners) listener(envelope);
  }

  /** Replay-only snapshot, no live phase — backs `WorkflowEventFeed.replay()`. */
  async *replaySnapshot(
    fromCursor?: string,
    limit?: number,
  ): AsyncGenerator<TEnvelope, void, void> {
    const afterSequence = decodeSequencedFeedCursor(fromCursor);
    const replay = this.#stored.filter((envelope) => envelope.sequence > afterSequence);
    const bounded = limit === undefined ? replay : replay.slice(0, limit);
    yield* bounded;
  }

  subscribe(options?: SequencedFeedSubscribeOptions<TEnvelope>): AsyncIterable<TEnvelope> {
    return this.#subscribe(options);
  }

  async *#subscribe(
    options: SequencedFeedSubscribeOptions<TEnvelope> | undefined,
  ): AsyncGenerator<TEnvelope, void, void> {
    const filter = options?.filterEnvelope ?? (() => true);
    const afterSequence = decodeSequencedFeedCursor(options?.fromCursor);
    const replay = this.#stored.filter((envelope) => envelope.sequence > afterSequence);
    this.#assertWithinReplayLimit(replay, options);

    const live = this.#registerLiveQueue();
    try {
      for (const envelope of replay) if (filter(envelope)) yield envelope;
      options?.onReplayComplete?.();
      yield* this.#drainLive(live, filter, options?.signal);
    } finally {
      live.unregister();
    }
  }

  #assertWithinReplayLimit(
    replay: readonly TEnvelope[],
    options: SequencedFeedSubscribeOptions<TEnvelope> | undefined,
  ): void {
    if (options?.replayLimit === undefined || replay.length <= options.replayLimit) return;
    throw (
      options.createReplayLimitError?.(replay.length, options.replayLimit) ??
      new Error(`replay window ${replay.length} exceeds limit ${options.replayLimit}`)
    );
  }

  #registerLiveQueue(): LiveQueueHandle<TEnvelope> {
    const queue: TEnvelope[] = [];
    let waker: (() => void) | null = null;
    const push = (envelope: TEnvelope): void => {
      queue.push(envelope);
      const resolve = waker;
      waker = null;
      resolve?.();
    };
    this.#liveListeners.add(push);
    return {
      queue,
      waitForNext: (signal) =>
        new Promise((resolve) => {
          waker = resolve;
          signal?.addEventListener('abort', () => resolve(), { once: true });
        }),
      unregister: () => this.#liveListeners.delete(push),
    };
  }

  async *#drainLive(
    live: LiveQueueHandle<TEnvelope>,
    filter: (envelope: TEnvelope) => boolean,
    signal: AbortSignal | undefined,
  ): AsyncGenerator<TEnvelope, void, void> {
    while (!isAborted(signal)) {
      while (live.queue.length > 0) {
        const envelope = live.queue.shift()!;
        if (filter(envelope)) yield envelope;
        if (isAborted(signal)) return;
      }
      await live.waitForNext(signal);
    }
  }
}

// See `sse-reader.ts`'s `isAborted` for why this is a function rather than
// inlining `signal?.aborted` — TypeScript's control-flow narrowing otherwise
// pins the live-mutated `.aborted` value across the loop body.
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
