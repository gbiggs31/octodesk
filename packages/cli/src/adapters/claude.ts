import type { SessionEvent, SessionEventType } from "@octodesk/core";

/** The subset of Claude Code hook payload fields octodesk reads. */
export interface ClaudeHookPayload {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  /** Notification hooks: human-readable reason, e.g. "Claude needs your permission to use Bash". */
  message?: string;
  /** SessionStart hooks: "startup" | "resume" | "clear" | "compact". */
  source?: string;
}

/**
 * Convert a Claude Code hook payload into the normalised event format.
 * Returns null for hooks octodesk does not care about.
 * No prompts, transcripts or tool arguments are ever forwarded.
 */
export function mapClaudeHook(payload: ClaudeHookPayload): SessionEvent | null {
  const event = eventFor(payload);
  if (event === null) return null;
  if (!payload.session_id) return null;
  return {
    provider: "claude",
    sessionId: payload.session_id,
    workingDirectory: payload.cwd ?? "",
    event,
    timestamp: new Date().toISOString(),
    wrapId: process.env.OCTO_WRAP_ID || undefined,
  };
}

function eventFor(payload: ClaudeHookPayload): SessionEventType | null {
  switch (payload.hook_event_name) {
    case "SessionStart":
      return "session_started";
    case "UserPromptSubmit":
      return "working";
    case "PreToolUse":
    case "PostToolUse":
      // Tool activity doubles as needs_input → working recovery after an approval.
      return "working";
    case "Notification": {
      const message = payload.message?.toLowerCase() ?? "";
      return message.includes("permission") ? "permission_requested" : "input_requested";
    }
    case "Stop":
      return "completed";
    case "SessionEnd":
      return "session_ended";
    default:
      return null; // SubagentStop, PreCompact, etc. — irrelevant to leg state
  }
}
