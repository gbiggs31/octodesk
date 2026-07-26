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
      ["event", "provider", "sessionId", "timestamp", "workingDirectory", "wrapId"].sort(),
    );
  });

  it("ignores irrelevant hooks and payloads without a session id", () => {
    expect(mapClaudeHook({ ...base, hook_event_name: "PreCompact" })).toBeNull();
    expect(mapClaudeHook({ ...base, hook_event_name: "SubagentStop" })).toBeNull();
    expect(mapClaudeHook({ hook_event_name: "Stop" })).toBeNull();
  });
});
