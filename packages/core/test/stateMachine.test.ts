import { describe, expect, it } from "vitest";
import { transition, type SessionEventType, type SessionState } from "../src/index.js";

describe("transition — new sessions", () => {
  it("creates idle on session_started", () => {
    expect(transition(undefined, "session_started")).toBe("idle");
  });

  it("creates sensible states when the daemon joins mid-session", () => {
    expect(transition(undefined, "working")).toBe("working");
    expect(transition(undefined, "permission_requested")).toBe("needs_input");
    expect(transition(undefined, "completed")).toBe("completed");
    expect(transition(undefined, "error")).toBe("error");
  });
});

describe("transition — the brief's happy path", () => {
  it("idle → working → needs_input → working → completed → ended", () => {
    let s: SessionState = "idle";
    const step = (e: SessionEventType) => {
      const next = transition(s, e);
      if (next !== null) s = next;
      return s;
    };
    expect(step("working")).toBe("working"); // prompt submitted
    expect(step("permission_requested")).toBe("needs_input"); // pulsing green
    expect(step("working")).toBe("working"); // permission granted, tool ran
    expect(step("completed")).toBe("completed"); // solid green
    expect(step("session_ended")).toBe("ended");
  });
});

describe("transition — edge behaviour", () => {
  it("heartbeat never changes state", () => {
    const states: SessionState[] = ["idle", "working", "needs_input", "completed", "error", "ended"];
    for (const s of states) expect(transition(s, "heartbeat")).toBeNull();
  });

  it("session_started on a live session is a no-op duplicate", () => {
    expect(transition("working", "session_started")).toBeNull();
    expect(transition("needs_input", "session_started")).toBeNull();
    expect(transition("idle", "session_started")).toBeNull();
  });

  it("session_started resumes finished or dead sessions to idle", () => {
    expect(transition("ended", "session_started")).toBe("idle");
    expect(transition("completed", "session_started")).toBe("idle");
    expect(transition("error", "session_started")).toBe("idle");
  });

  it("straggler events after session_ended are ignored", () => {
    expect(transition("ended", "working")).toBeNull();
    expect(transition("ended", "completed")).toBeNull();
    expect(transition("ended", "permission_requested")).toBeNull();
  });

  it("error is reachable from anywhere and sticky until resume/working", () => {
    expect(transition("working", "error")).toBe("error");
    expect(transition("ended", "error")).toBe("error");
    expect(transition("error", "working")).toBe("working");
  });
});
