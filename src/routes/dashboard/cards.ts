import type { Component } from 'svelte';

import ReviewsDashboardCard from '../reviews/cards/dashboard-card.svelte';
import SchedulesDashboardCard from '../schedules/cards/dashboard-card.svelte';
import WorkersDashboardCard from '../workers/cards/dashboard-card.svelte';
import WorkflowsDashboardCard from '../workflows/cards/dashboard-card.svelte';

/**
 * Card-slot contract (plan §13.0, PROJECT-BRIEF "Shared contracts"): each
 * track that contributes a dashboard card owns its card component under its
 * own `src/routes/<domain>/cards/` directory and registers it here. This is
 * the ONE shared file every dashboard-card-owning track touches — keep each
 * entry to a one-line import + registration so concurrent tracks rarely
 * conflict on the same lines.
 */
export interface DashboardCardEntry {
  id: string;
  component: Component;
}

export const dashboardCards: readonly DashboardCardEntry[] = [
  { id: 'workflows', component: WorkflowsDashboardCard },
  { id: 'schedules', component: SchedulesDashboardCard },
  { id: 'workers', component: WorkersDashboardCard },
  { id: 'reviews', component: ReviewsDashboardCard },
];
