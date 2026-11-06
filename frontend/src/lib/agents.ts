import type { Agent } from './types';

/** "smart-contracts" -> "Smart contracts" */
export const prettyTag = (s: string) => { const t = s.replace(/[-_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };

export const passRate = (a: Pick<Agent, 'jobsCompleted' | 'jobsFailed'>): number | null => {
  const done = (a.jobsCompleted ?? 0) + (a.jobsFailed ?? 0);
  return done ? Math.round(((a.jobsCompleted ?? 0) / done) * 100) : null;
};

export const jobsDone = (a: Pick<Agent, 'jobsCompleted' | 'jobsFailed'>) => (a.jobsCompleted ?? 0) + (a.jobsFailed ?? 0);

// The custom (code) checks the backend runs; the rest of a benchmark's items come from the AI review.
export const CODE_CHECKS: Record<string, string> = {
  readme_present: 'README present',
  entry_point_exists: 'Entry point exists',
  manifest_valid: 'Manifest valid',
  capabilities_match_code: 'Capabilities match the code',
};
