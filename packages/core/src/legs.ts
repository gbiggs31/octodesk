import { LEG_COUNT, type SessionRecord } from "./types.js";

/** Lowest-numbered free leg (1-based), or null when all legs are taken. */
export function firstFreeLeg(records: SessionRecord[]): number | null {
  const taken = new Set(records.map((r) => r.leg).filter((l): l is number => l !== null));
  for (let leg = 1; leg <= LEG_COUNT; leg++) {
    if (!taken.has(leg)) return leg;
  }
  return null;
}

/**
 * Preferred leg for a session: reclaim `previousLeg` if it is free,
 * otherwise the first free leg, otherwise null (waiting list).
 */
export function allocateLeg(
  records: SessionRecord[],
  previousLeg?: number | null,
): number | null {
  if (previousLeg != null) {
    const occupied = records.some((r) => r.leg === previousLeg);
    if (!occupied && previousLeg >= 1 && previousLeg <= LEG_COUNT) return previousLeg;
  }
  return firstFreeLeg(records);
}

/**
 * When a leg frees up, the longest-waiting leg-less live session gets it.
 * Returns the session that should be promoted, or null.
 */
export function nextWaitingSession(records: SessionRecord[]): SessionRecord | null {
  const waiting = records
    .filter((r) => r.leg === null && r.state !== "ended")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sessionId.localeCompare(b.sessionId));
  return waiting[0] ?? null;
}
