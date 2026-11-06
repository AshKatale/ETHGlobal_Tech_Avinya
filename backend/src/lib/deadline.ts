// Deadline policy (S-15). A client cannot set a deadline so close that it could refund itself right after funding.
export const MIN_DEADLINE_MS = 15 * 60 * 1000;
export const DEFAULT_DEADLINE_MS = 7 * 24 * 3600 * 1000;

/** Returns an error string when `deadline` is less than 15 minutes after `now`, otherwise null. */
export function deadlineError(deadline: Date, now: number = Date.now()): string | null {
  if (Number.isNaN(deadline.getTime())) return 'deadlineAt is not a valid date';
  if (deadline.getTime() < now + MIN_DEADLINE_MS) return 'deadlineAt must be at least 15 minutes from now';
  return null;
}

export const defaultDeadline = (now: number = Date.now()) => new Date(now + DEFAULT_DEADLINE_MS);
