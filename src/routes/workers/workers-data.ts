/**
 * Query/mutation wiring for the Workers/Queues/Diagnostics surface (Track C,
 * plan §4, §9.4). Plain, framework-free functions over the narrow slice of
 * `HttpClient` each one needs — `.svelte` files wire these into
 * `createQuery`/`createMutation` (`@tanstack/svelte-query`), following the
 * same split `reviews-data.ts`/`schedule-queries.ts` established: logic here
 * stays unit-testable without a DOM, `.svelte` files stay thin.
 *
 * None of the three list queries take reactive params (`weft.workers.list`
 * and `weft.task.queues.list` accept `{}`; `weft.tasks.diagnostics` always
 * runs with the same server-mirrored defaults — `worker-catalog-types.ts`'s
 * `DEFAULT_TASK_DIAGNOSTICS_INPUT`), so these use `createQuery`'s plain-object
 * form rather than `reviews-data.ts`'s `toStore(() => ({...}))` bridge —
 * nothing here ever needs to re-key.
 *
 * All three poll every 30s (plan §5.3: "the default for low-churn surfaces
 * … workers ~30s") as the baseline freshness guarantee; `index.svelte`
 * layers an opt-in subscription to the shell's ONE shared `FleetEventSource`
 * (`getFleetEventSource()`, `src/app/engine-status.svelte.ts`) on top for
 * instant invalidation on `worker:connected`/`worker:disconnected`. The
 * toggle only gates that subscription — it never opens a second connection —
 * per plan §5's ≤3-connection budget: "one fleet SSE … never per-row/
 * per-surface connections".
 */
import type { HttpClient } from '@lostgradient/weft/client';

import {
  createMutation,
  createQuery,
  type CreateMutationResult,
  type CreateQueryResult,
} from '@tanstack/svelte-query';

import { queryKeys } from '../../lib/query.ts';
import { clearDeadLetter } from './dead-letter-request.ts';
import {
  DEFAULT_TASK_DIAGNOSTICS_INPUT,
  type TaskDiagnosticsOutput,
  type WorkersListOutput,
} from './worker-catalog-types.ts';

const REFETCH_INTERVAL_MS = 30_000;

type WorkersOperations = Pick<HttpClient, 'operations'>;

/** `GET /v1/workers` (`system:read`) — fleet + deployment rollup + routing policy. */
export function workersListQuery(client: WorkersOperations): CreateQueryResult<WorkersListOutput> {
  return createQuery({
    queryKey: queryKeys.workers.list(),
    queryFn: () => client.operations['weft.workers.list']({}),
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}

/** `GET /v1/task-queues` (`system:read`). */
export function taskQueuesListQuery(client: WorkersOperations) {
  return createQuery({
    queryKey: queryKeys.queues.list(),
    queryFn: () => client.operations['weft.task.queues.list']({}),
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}

/** `GET /v1/tasks/diagnostics` (`system:read`), server-mirrored default thresholds. */
export function taskDiagnosticsQuery(
  client: WorkersOperations,
): CreateQueryResult<TaskDiagnosticsOutput> {
  return createQuery({
    queryKey: queryKeys.diagnostics(),
    queryFn: () => client.operations['weft.tasks.diagnostics'](DEFAULT_TASK_DIAGNOSTICS_INPUT),
    refetchInterval: REFETCH_INTERVAL_MS,
  });
}

export interface DrainWorkerVariables {
  readonly workerId: string;
  readonly reason?: string;
}

/** `POST /v1/workers/:id/drain` (`system:admin`). */
export function drainWorkerMutation(
  client: WorkersOperations,
  onSettled: () => void,
): CreateMutationResult<unknown, Error, DrainWorkerVariables> {
  return createMutation({
    mutationFn: (variables: DrainWorkerVariables) =>
      client.operations['weft.workers.drain'](variables),
    onSettled,
  });
}

/** `DELETE /v1/workers/:id/drain` (`system:admin`). */
export function resumeWorkerMutation(
  client: WorkersOperations,
  onSettled: () => void,
): CreateMutationResult<unknown, Error, { workerId: string }> {
  return createMutation({
    mutationFn: (variables: { workerId: string }) =>
      client.operations['weft.workers.resume'](variables),
    onSettled,
  });
}

export interface DrainDeploymentVariables {
  readonly deploymentName: string;
  readonly reason?: string;
}

/** `POST /v1/worker-deployments/:name/drain` (`system:admin`). */
export function drainDeploymentMutation(
  client: WorkersOperations,
  onSettled: () => void,
): CreateMutationResult<unknown, Error, DrainDeploymentVariables> {
  return createMutation({
    mutationFn: (variables: DrainDeploymentVariables) =>
      client.operations['weft.worker.deployments.drain'](variables),
    onSettled,
  });
}

/** `DELETE /v1/worker-deployments/:name/drain` (`system:admin`). */
export function resumeDeploymentMutation(
  client: WorkersOperations,
  onSettled: () => void,
): CreateMutationResult<unknown, Error, { deploymentName: string }> {
  return createMutation({
    mutationFn: (variables: { deploymentName: string }) =>
      client.operations['weft.worker.deployments.resume'](variables),
    onSettled,
  });
}

type DeadLetterClient = Parameters<typeof clearDeadLetter>[0];

/** `DELETE /v1/tasks/diagnostics/dead-letter/:operationId` (`system:admin`) — see `dead-letter-request.ts` for why this isn't a `client.operations[...]` call. */
export function clearDeadLetterMutation(
  client: DeadLetterClient,
  onSettled: () => void,
): CreateMutationResult<void, Error, { operationId: string }> {
  return createMutation({
    mutationFn: ({ operationId }: { operationId: string }) => clearDeadLetter(client, operationId),
    onSettled,
  });
}
