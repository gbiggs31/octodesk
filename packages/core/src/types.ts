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
  /** Set by the `octo` wrapper via OCTO_WRAP_ID env inheritance (window correlation). */
  wrapId?: string;
  /**
   * Set on session_started when this session was launched as a resume of an
   * earlier one (OCTO_RESUME_OF). If the agent minted a fresh session id, the
   * daemon migrates the old session's leg to this one.
   */
  resumeOf?: string;
}

/** A live `octo` wrapper process: the bridge between a session and its terminal window. */
export interface WrapperInfo {
  wrapId: string;
  /** PID of the wrapper process (dies with its terminal). */
  pid: number;
  /** Win32 HWND of the terminal window captured at wrapper launch, as a decimal string. */
  windowHandle: string | null;
  workingDirectory: string;
  createdAt: string;
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

export type LightColor = "off" | "white" | "yellow" | "green" | "blue" | "red";
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
