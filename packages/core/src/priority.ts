import type { SessionRecord, SessionState } from "./types.js";

/** Highest attention first. `ended` sessions never drive the head. */
export const STATE_PRIORITY: readonly SessionState[] = [
  "error",
  "needs_input",
  "completed",
  "working",
  "idle",
];

function rank(state: SessionState): number {
  const i = STATE_PRIORITY.indexOf(state);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** State the head should display, or null when there is nothing to show (head off). */
export function headState(records: SessionRecord[]): SessionState | null {
  let best: SessionState | null = null;
  for (const r of records) {
    if (r.state === "ended") continue;
    if (best === null || rank(r.state) < rank(best)) best = r.state;
  }
  return best;
}

/**
 * Sessions in the head's current priority class, in deterministic press-cycle
 * order: oldest unresolved (lastEventAt) first, sessionId as tie-break.
 */
export function pressCycleOrder(records: SessionRecord[]): SessionRecord[] {
  const top = headState(records);
  if (top === null) return [];
  return records
    .filter((r) => r.state === top)
    .sort(
      (a, b) =>
        a.lastEventAt.localeCompare(b.lastEventAt) ||
        a.sessionId.localeCompare(b.sessionId),
    );
}

/**
 * Target for a head press. `cursor` is the sessionId targeted by the previous
 * press; repeated presses cycle through the class. A cursor that is no longer
 * in the class (state changed, session cleared) resets to the first target.
 */
export function nextHeadTarget(
  records: SessionRecord[],
  cursor: string | null,
): SessionRecord | null {
  const cycle = pressCycleOrder(records);
  if (cycle.length === 0) return null;
  if (cursor !== null) {
    const i = cycle.findIndex((r) => r.sessionId === cursor);
    if (i !== -1) return cycle[(i + 1) % cycle.length] ?? null;
  }
  return cycle[0] ?? null;
}
