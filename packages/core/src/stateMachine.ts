import type { SessionEventType, SessionState } from "./types.js";

/**
 * Pure session state machine.
 *
 * Returns the next state, or null when the event causes no state change
 * (the caller should still bump lastEventAt for liveness tracking).
 *
 * `current` is undefined for a session the engine has never seen; any first
 * event creates the session in a sensible state so the daemon can pick up
 * sessions that were already running when it started.
 */
export function transition(
  current: SessionState | undefined,
  event: SessionEventType,
): SessionState | null {
  if (current === undefined) {
    switch (event) {
      case "session_started":
        return "idle";
      case "working":
        return "working";
      case "permission_requested":
      case "input_requested":
        return "needs_input";
      case "completed":
        return "completed";
      case "error":
        return "error";
      case "session_ended":
        return "ended";
      case "heartbeat":
        return "idle";
    }
  }

  switch (event) {
    case "heartbeat":
      return null;
    case "session_started":
      // A start on a live session is a duplicate; on a finished/dead one it is a resume.
      return current === "ended" || current === "completed" || current === "error"
        ? "idle"
        : null;
    case "working":
      // Events arriving after session_ended are stragglers — ignore until an explicit resume.
      return current === "ended" ? null : "working";
    case "permission_requested":
    case "input_requested":
      return current === "ended" ? null : "needs_input";
    case "completed":
      return current === "ended" ? null : "completed";
    case "error":
      return "error";
    case "session_ended":
      return "ended";
  }
}
