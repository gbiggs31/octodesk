/** Providers the daemon understands. Codex is retained in the model but has no adapter yet. */
export type AgentProvider = "claude" | "codex";

export type SessionEventType =
  | "session_started"
  | "working"
  | "permission_requested"
  | "input_requested"
  | "completed"
  | "error"
  | "session_ended"
  | "heartbeat";

/** Normalised event: every adapter (Claude hooks, simulator, future Codex) emits exactly this. */
export interface SessionEvent {
  provider: AgentProvider;
  sessionId: string;
  workingDirectory: string;
  event: SessionEventType;
  timestamp: string;
  /** Set by the `octo` wrapper via OCTO_WRAP_ID env inheritance (Phase 2 window correlation). */
  wrapId?: string;
}

export type SessionState =
  | "idle"
  | "working"
  | "needs_input"
  | "completed"
  | "error"
  | "ended";

export interface SessionRecord {
  /** 1-based leg number, or null when all legs are taken (waiting list). */
  leg: number | null;
  provider: AgentProvider;
  sessionId: string;
  workingDirectory: string;
  projectName: string;
  state: SessionState;
  createdAt: string;
  lastEventAt: string;
  wrapId?: string | null;
  /** Human-readable explanation shown in the dashboard (e.g. why a session errored). */
  note?: string | null;
}

export const LEG_COUNT = 8;

export type LightColor = "off" | "white" | "yellow" | "green" | "red";
export type LightMode = "off" | "dim" | "solid" | "pulse" | "flash";

export interface LightSpec {
  color: LightColor;
  mode: LightMode;
}

/**
 * One instruction to the (virtual or physical) device.
 * The future USB serial protocol is a direct text encoding of this shape.
 */
export interface DeviceCommand extends LightSpec {
  target: "leg" | "head";
  /** Required when target is "leg". */
  leg?: number;
}
