import { describe, expect, it } from "vitest";
import {
  headState,
  nextHeadTarget,
  pressCycleOrder,
  type SessionRecord,
  type SessionState,
} from "../src/index.js";

function record(
  sessionId: string,
  state: SessionState,
  lastEventAt = "2026-07-26T10:00:00.000Z",
): SessionRecord {
  return {
    leg: null,
    provider: "claude",
    sessionId,
    workingDirectory: "C:\\dev\\proj",
    projectName: "proj",
    state,
    createdAt: "2026-07-26T09:00:00.000Z",
    lastEventAt,
  };
}

describe("headState", () => {
  it("is null (head off) with no sessions", () => {
    expect(headState([])).toBeNull();
  });

  it("is null when only ended sessions remain", () => {
    expect(headState([record("a", "ended")])).toBeNull();
  });

  it("follows the priority order error > needs_input > completed > working > idle", () => {
    const base = [record("i", "idle"), record("w", "working")];
    expect(headState(base)).toBe("working");
    expect(headState([...base, record("c", "completed")])).toBe("completed");
    expect(headState([...base, record("c", "completed"), record("n", "needs_input")])).toBe("needs_input");
    expect(headState([...base, record("n", "needs_input"), record("e", "error")])).toBe("error");
  });
});

describe("pressCycleOrder", () => {
  it("contains only the top-priority class, oldest event first", () => {
    const records = [
      record("n2", "needs_input", "2026-07-26T10:30:00.000Z"),
      record("w1", "working", "2026-07-26T09:00:00.000Z"),
      record("n1", "needs_input", "2026-07-26T10:00:00.000Z"),
    ];
    expect(pressCycleOrder(records).map((r) => r.sessionId)).toEqual(["n1", "n2"]);
  });

  it("breaks lastEventAt ties deterministically by sessionId", () => {
    const t = "2026-07-26T10:00:00.000Z";
    const records = [record("b", "completed", t), record("a", "completed", t)];
    expect(pressCycleOrder(records).map((r) => r.sessionId)).toEqual(["a", "b"]);
  });
});

describe("nextHeadTarget", () => {
  const records = [
    record("n1", "needs_input", "2026-07-26T10:00:00.000Z"),
    record("n2", "needs_input", "2026-07-26T10:30:00.000Z"),
    record("w1", "working"),
  ];

  it("first press targets the oldest unresolved session", () => {
    expect(nextHeadTarget(records, null)?.sessionId).toBe("n1");
  });

  it("repeated presses cycle through the class and wrap around", () => {
    expect(nextHeadTarget(records, "n1")?.sessionId).toBe("n2");
    expect(nextHeadTarget(records, "n2")?.sessionId).toBe("n1");
  });

  it("a stale cursor (state changed) resets to the first target", () => {
    expect(nextHeadTarget(records, "w1")?.sessionId).toBe("n1");
    expect(nextHeadTarget(records, "gone")?.sessionId).toBe("n1");
  });

  it("returns null when there is nothing to focus", () => {
    expect(nextHeadTarget([], null)).toBeNull();
    expect(nextHeadTarget([record("dead", "ended")], null)).toBeNull();
  });
});
