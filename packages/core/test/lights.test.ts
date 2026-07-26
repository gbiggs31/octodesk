import { describe, expect, it } from "vitest";
import {
  deviceFrame,
  encodeCommand,
  lightForState,
  type SessionRecord,
} from "../src/index.js";

function record(sessionId: string, leg: number | null, state: SessionRecord["state"]): SessionRecord {
  return {
    leg,
    provider: "claude",
    sessionId,
    workingDirectory: "C:\\dev\\proj",
    projectName: "proj",
    state,
    createdAt: "2026-07-26T09:00:00.000Z",
    lastEventAt: "2026-07-26T10:00:00.000Z",
  };
}

describe("lightForState", () => {
  it("maps every state to the brief's colours", () => {
    expect(lightForState(null)).toEqual({ color: "off", mode: "off" });
    expect(lightForState("idle")).toEqual({ color: "white", mode: "dim" });
    expect(lightForState("ended")).toEqual({ color: "white", mode: "dim" });
    expect(lightForState("working")).toEqual({ color: "yellow", mode: "pulse" });
    expect(lightForState("needs_input")).toEqual({ color: "green", mode: "pulse" });
    expect(lightForState("completed")).toEqual({ color: "green", mode: "solid" });
    expect(lightForState("error")).toEqual({ color: "red", mode: "flash" });
  });
});

describe("deviceFrame", () => {
  it("emits 8 leg commands plus a head command", () => {
    const frame = deviceFrame([]);
    expect(frame).toHaveLength(9);
    expect(frame.filter((c) => c.target === "leg")).toHaveLength(8);
    expect(frame.at(-1)?.target).toBe("head");
  });

  it("lights assigned legs and keeps the rest off; head shows top priority", () => {
    const frame = deviceFrame([
      record("a", 1, "working"),
      record("b", 3, "needs_input"),
    ]);
    expect(frame[0]).toMatchObject({ target: "leg", leg: 1, color: "yellow", mode: "pulse" });
    expect(frame[1]).toMatchObject({ target: "leg", leg: 2, color: "off" });
    expect(frame[2]).toMatchObject({ target: "leg", leg: 3, color: "green", mode: "pulse" });
    expect(frame.at(-1)).toMatchObject({ target: "head", color: "green", mode: "pulse" });
  });
});

describe("encodeCommand — future serial protocol", () => {
  it("encodes the brief's example messages", () => {
    expect(encodeCommand({ target: "leg", leg: 1, color: "yellow", mode: "pulse" })).toBe("LEG 1 YELLOW PULSE");
    expect(encodeCommand({ target: "leg", leg: 2, color: "green", mode: "solid" })).toBe("LEG 2 GREEN SOLID");
    expect(encodeCommand({ target: "leg", leg: 3, color: "off", mode: "off" })).toBe("LEG 3 OFF");
    expect(encodeCommand({ target: "head", color: "red", mode: "flash" })).toBe("HEAD RED FLASH");
  });

  it("encodes dim white", () => {
    expect(encodeCommand({ target: "leg", leg: 4, color: "white", mode: "dim" })).toBe("LEG 4 WHITE DIM");
  });
});
