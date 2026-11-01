export type RunStatus = 'ok' | 'retry' | 'fail';

/**
 * A validated JSONL record. The reader accepts only objects with a non-empty job,
 * a valid ISO 8601 timestamp with an explicit timezone (offset or Z), a known
 * status, a string or null owner, and an optional string error. Extra fields may
 * be ignored. Parsing and schema validation belong at the read boundary.
 */
export type RunEvent = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

/** One job's valid events, ordered chronologically rather than by file order. */
export type DigestRow = {
  job: string;
  /** Owner on the latest event, including an explicit null. */
  owner: string | null;
  /** Number of all valid events for this job, including retries and failures. */
  runs: number;
  /** Number of valid events whose status is retry. */
  retries: number;
  lastStatus: RunStatus;
  /** Latest non-whitespace error, retained even after a later successful event. */
  lastError: string | null;
  /** Original timestamp strings, preserving their offsets for display. */
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  /** One row per job, sorted by ascending job string using code-unit order. */
  rows: DigestRow[];
  /** Nonblank lines rejected by JSON parsing or record schema validation. */
  badLines: number;
  /** Counts of valid events by status, not counts of each job's final status. */
  counts: Record<RunStatus, number>;
};

/**
 * Synchronously read runsDir/<night>.jsonl. Night must be a real calendar date in
 * exact YYYY-MM-DD form; reject invalid input before constructing a file path.
 * Return null for an invalid night or missing file. An existing empty file
 * returns empty rows, zero badLines, and zero for each status count. Other I/O
 * failures propagate instead of masquerading as an absent or empty night.
 *
 * Ignore blank lines. Count and skip each invalid nonblank record without
 * discarding the remaining night. Keep jobs with null owners. All aggregation
 * uses valid events only.
 *
 * Order events by their timestamp instants, breaking ties by input line order.
 * firstAt comes from the earliest event (earlier line on a tie); lastAt, owner,
 * and lastStatus come from the latest event (later line on a tie). lastError
 * comes from the latest event with a non-whitespace error, using the same tie
 * rule, or null if none exists. Preserve original timestamps and error strings.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
