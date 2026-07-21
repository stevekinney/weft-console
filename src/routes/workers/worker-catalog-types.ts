/**
 * Types for this track derived from the generated operation catalog itself
 * (plan §4: "no hand-maintained API types … drift is caught by bumping the
 * `@lostgradient/weft` dependency and type-checking"), rather than
 * hand-copied from `weft/src/worker/registry.ts` /
 * `weft/src/server/task-queue-types.ts` / `weft/src/server/operations/
 * get-task-diagnostics.ts` — none of which are exported as values or types
 * from any public `@lostgradient/weft` subpath. Deriving from
 * `HttpClient['operations'][...]`'s own return type means a future catalog
 * change surfaces here as a type error, not a silent shape mismatch.
 */
import type { HttpClient } from '@lostgradient/weft/client';

type Operations = HttpClient['operations'];

export type WorkersListOutput = Awaited<ReturnType<Operations['weft.workers.list']>>;
export type WorkerSummary = WorkersListOutput['items'][number];
export type WorkerDeploymentSummary = WorkersListOutput['deployments'][number];
export type WorkerHealth = WorkerSummary['health'];

export type TaskQueuesListOutput = Awaited<ReturnType<Operations['weft.task.queues.list']>>;
export type TaskQueueHealth = TaskQueuesListOutput['items'][number];

export type TaskDiagnosticsOutput = Awaited<ReturnType<Operations['weft.tasks.diagnostics']>>;
export type TaskDiagnosticItem = TaskDiagnosticsOutput['items'][number];
export type TaskDiagnosticKind = TaskDiagnosticItem['kind'];
export type TaskDiagnosticsSummary = TaskDiagnosticsOutput['summary'];

/** `weft.tasks.diagnostics` input fields the generated client types as required (mirroring the server's Zod `.default(...)` values, which the catalog generator does not reflect as optional — plan §9.4 T5.4). */
export const DEFAULT_TASK_DIAGNOSTICS_INPUT = {
  staleQueuedAfterMs: 60_000,
  staleHeartbeatAfterMs: 60_000,
  retryStormMinimumAttempts: 3,
  limit: 50,
} as const;
