import { useState } from "react";
import type { AgentProvider, SessionEventType, SessionRecord } from "@octodesk/core";
import { sendEvent } from "./api.js";

const PROJECT_NAMES = [
  "coral-reef",
  "kelp-forest",
  "tide-pool",
  "moon-jelly",
  "ink-cloud",
  "barnacle",
  "driftwood",
  "sea-grape",
  "anemone",
  "cuttlefish",
];

const ACTIONS: Array<{ label: string; event: SessionEventType; title: string }> = [
  { label: "Prompt", event: "working", title: "User submits a prompt → working (yellow pulse)" },
  { label: "Permission", event: "permission_requested", title: "Agent asks permission → needs input (green pulse)" },
  { label: "Question", event: "input_requested", title: "Agent asks for input → needs input (green pulse)" },
  { label: "Finish", event: "completed", title: "Turn ends → completed (solid green)" },
  { label: "Error", event: "error", title: "Terminal failure → error (red flash)" },
  { label: "End", event: "session_ended", title: "Session exits → ended (leg kept until cleared/expired)" },
  { label: "Resume", event: "session_started", title: "Session restarts → idle" },
];

/** Fake event generator: exercises the exact /api/events pipeline real adapters use. */
export function Simulator({ sessions }: { sessions: SessionRecord[] }) {
  const [provider, setProvider] = useState<AgentProvider>("claude");
  const [target, setTarget] = useState<string>("");

  const targetSession =
    sessions.find((s) => `${s.provider}:${s.sessionId}` === target) ??
    sessions.find((s) => s.sessionId.startsWith("sim-"));

  async function spawn() {
    const name = PROJECT_NAMES[Math.floor(Math.random() * PROJECT_NAMES.length)];
    const sessionId = `sim-${Date.now().toString(36)}`;
    await sendEvent(provider, sessionId, `C:\\sim\\${name}`, "session_started");
    setTarget(`${provider}:${sessionId}`);
  }

  return (
    <div className="simulator">
      <div className="sim-row">
        <select value={provider} onChange={(e) => setProvider(e.target.value as AgentProvider)}>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
        <button onClick={() => void spawn()}>+ New session</button>
      </div>

      {sessions.length > 0 && (
        <>
          <div className="sim-row">
            <label htmlFor="sim-target">Act on</label>
            <select
              id="sim-target"
              value={targetSession ? `${targetSession.provider}:${targetSession.sessionId}` : ""}
              onChange={(e) => setTarget(e.target.value)}
            >
              {sessions.map((s) => (
                <option key={`${s.provider}:${s.sessionId}`} value={`${s.provider}:${s.sessionId}`}>
                  {s.leg !== null ? `leg ${s.leg} · ` : ""}
                  {s.projectName} ({s.provider})
                </option>
              ))}
            </select>
          </div>
          <div className="sim-actions">
            {ACTIONS.map((a) => (
              <button
                key={a.event}
                title={a.title}
                disabled={!targetSession}
                onClick={() => {
                  if (!targetSession) return;
                  void sendEvent(
                    targetSession.provider,
                    targetSession.sessionId,
                    targetSession.workingDirectory,
                    a.event,
                  );
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
