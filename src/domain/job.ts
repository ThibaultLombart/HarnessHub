export const jobStatuses = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof jobStatuses)[number];

const allowedTransitions: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  queued: new Set(["running", "cancelled"]),
  running: new Set(["succeeded", "failed", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class InvalidJobTransitionError extends Error {
  public constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid job transition: ${from} -> ${to}`);
    this.name = "InvalidJobTransitionError";
  }
}

export function transitionJob(from: JobStatus, to: JobStatus): JobStatus {
  if (!allowedTransitions[from].has(to)) {
    throw new InvalidJobTransitionError(from, to);
  }
  return to;
}
