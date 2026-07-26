import { LEG_COUNT, type DeviceCommand, type LightSpec, type SessionRecord, type SessionState } from "./types.js";
import { headState } from "./priority.js";

/**
 * The single source of truth for state → light mapping.
 * The physical firmware will implement exactly these color/mode pairs.
 */
export function lightForState(state: SessionState | null): LightSpec {
  switch (state) {
    case null:
      return { color: "off", mode: "off" }; // unassigned leg
    case "idle":
    case "ended": // assigned but dormant; resumable by pressing the leg
      return { color: "white", mode: "dim" };
    case "working":
      return { color: "yellow", mode: "pulse" };
    case "needs_input":
      return { color: "green", mode: "pulse" };
    case "completed":
      return { color: "green", mode: "solid" };
    case "error":
      return { color: "red", mode: "flash" };
  }
}

/** Full device frame: one command per leg plus the head. */
export function deviceFrame(records: SessionRecord[]): DeviceCommand[] {
  const byLeg = new Map<number, SessionRecord>();
  for (const r of records) {
    if (r.leg !== null) byLeg.set(r.leg, r);
  }
  const commands: DeviceCommand[] = [];
  for (let leg = 1; leg <= LEG_COUNT; leg++) {
    const spec = lightForState(byLeg.get(leg)?.state ?? null);
    commands.push({ target: "leg", leg, ...spec });
  }
  commands.push({ target: "head", ...lightForState(headState(records)) });
  return commands;
}

/**
 * Text encoding for the future USB serial link, e.g.
 *   "LEG 1 YELLOW PULSE", "LEG 3 OFF", "HEAD RED FLASH"
 */
export function encodeCommand(cmd: DeviceCommand): string {
  const target = cmd.target === "head" ? "HEAD" : `LEG ${cmd.leg}`;
  if (cmd.color === "off" || cmd.mode === "off") return `${target} OFF`;
  return `${target} ${cmd.color.toUpperCase()} ${cmd.mode.toUpperCase()}`;
}
