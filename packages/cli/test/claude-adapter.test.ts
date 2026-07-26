import { describe, expect, it } from "vitest";
import { mapClaudeHook } from "../src/adapters/claude.js";

const base = { session_id: "abc-123", cwd: "C:\\dev\\proj" };

describe("mapClaudeHook", () => {
  it("maps lifecycle hooks to normalised events", () => {
    expect(mapClaudeHook({ ...base, hook_event_name: "SessionStart", source: "startup" })?.event).toBe("session_started");
    expect(mapClaudeHook({ ...base, hook_event_name: "UserPromptSubmit" })?.event).toBe("working");
    expect(mapClaudeHook({ ...base, hook_event_name: "PostToolUse" })?.event).toBe("working");
    expect(mapClaudeHook({ ...base, hook_event_name: "Stop" })?.event).toBe("completed");
    expect(mapClaudeHook({ ...base, hook_event_name: "SessionEnd" })?.event).toBe("session_ended");
  });

  it("splits Notification into permission vs input requests", () => {
    expect(
      mapClaudeHook({ ...base, hook_event_name: "Notification", message: "Claude needs your permission to use Bash" })?.event,
    ).toBe("permission_requested");
    expect(
      mapClaudeHook({ ...base, hook_event_name: "Notification", message: "Claude is waiting for your input" })?.event,
    ).toBe("input_requested");
  });

  it("carries provider, session id and cwd; never any content fields", () => {
    const ev = mapClaudeHook({ ...base, hook_event_name: "Stop" })!;
    expect(ev.provider).toBe("claude");
    expect(ev.sessionId).toBe("abc-123");
    expect(ev.workingDirectory).toBe("C:\\dev\\proj");
    expect(Object.keys(ev).sort()).toEqual(
      ["event", "provider", "sessionId", "timestamp", "workingDirectory"].sort(),
    );
  });

  it("attaches wrapId and resumeOf from the wrapper's environment", () => {
    process.env.OCTO_WRAP_ID = "wrap-9";
    process.env.OCTO_RESUME_OF = "old-session";
    try {
      const started = mapClaudeHook({ ...base, hook_event_name: "SessionStart" })!;
      expect(started.wrapId).toBe("wrap-9");
      expect(started.resumeOf).toBe("old-session");
      // resumeOf is only meaningful at session start
      const working = mapClaudeHook({ ...base, hook_event_name: "UserPromptSubmit" })!;
      expect(working.wrapId).toBe("wrap-9");
      expect(working.resumeOf).toBeUndefined();
    } finally {
      delete process.env.OCTO_WRAP_ID;
      delete process.env.OCTO_RESUME_OF;
    }
  });

  it("ignores irrelevant hooks and payloads without a session id", () => {
    expect(mapClaudeHook({ ...base, hook_event_name: "PreCompact" })).toBeNull();
    expect(mapClaudeHook({ ...base, hook_event_name: "SubagentStop" })).toBeNull();
    expect(mapClaudeHook({ hook_event_name: "Stop" })).toBeNull();
  });
});
