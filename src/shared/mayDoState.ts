export const MAY_DO_STATUSES = ['suggested', 'selected', 'done', 'dismissed'] as const;
export type ActionStatus = typeof MAY_DO_STATUSES[number];

/** One count contract for full sidecars and lightweight index responses. */
export function mayDoCounts(value: any) {
  const counts: Record<ActionStatus, number> = { suggested: 0, selected: 0, done: 0, dismissed: 0 };
  const rows = Array.isArray(value) ? value : value?.mayDos;
  if (Array.isArray(rows)) {
    for (const row of rows) if (row && MAY_DO_STATUSES.includes(row.status)) counts[row.status as ActionStatus]++;
  } else if (value?.mayDoStatusCounts) {
    for (const status of MAY_DO_STATUSES) counts[status] = Math.max(0, Number(value.mayDoStatusCounts[status]) || 0);
  }
  const total = Array.isArray(rows) || value?.mayDoStatusCounts ? Object.values(counts).reduce((a, b) => a + b, 0) : Number(value?.mayDoTotalCount ?? value?.mayDoCount) || 0;
  const active = Array.isArray(rows) || value?.mayDoStatusCounts ? counts.suggested + counts.selected : Number(value?.mayDoActiveCount) || 0;
  return { mayDoCount: total, mayDoTotalCount: total, mayDoActiveCount: active, mayDoStatusCounts: counts, mayDoStatuses: MAY_DO_STATUSES.filter(status => counts[status] > 0) };
}

export const MAY_DO_PRIMARY = {
  suggested: { label: 'Select', status: 'selected' },
  selected: { label: 'Mark done', status: 'done' },
  done: { label: 'Reopen as Selected', status: 'selected' },
  dismissed: { label: 'Restore as Suggested', status: 'suggested' },
} as const;
