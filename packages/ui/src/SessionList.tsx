import type { SessionRecord } from "@octodesk/core";
import { clearSession, reassignSession } from "./api.js";

const STATE_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  needs_input: "Needs input",
  completed: "Done",
  error: "Error",
  ended: "Ended",
};

function relativeTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 15_000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function SessionList({
  sessions,
  selected,
}: {
  sessions: SessionRecord[];
  selected: { provider: string; sessionId: string } | null;
}) {
  if (sessions.length === 0) {
    return <p className="empty">No sessions yet — start one with the simulator below or run Claude Code with octodesk hooks installed.</p>;
  }
  return (
    <table className="session-table">
      <thead>
        <tr>
          <th>Leg</th>
          <th>Project</th>
          <th>Provider</th>
          <th>State</th>
          <th>Last event</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => {
          const isSelected =
            selected?.provider === s.provider && selected?.sessionId === s.sessionId;
          return (
            <tr key={`${s.provider}:${s.sessionId}`} className={isSelected ? "selected" : ""}>
              <td>
                <select
                  className="leg-select"
                  value={s.leg ?? ""}
                  onChange={(e) => {
                    const leg = Number(e.target.value);
                    if (leg) void reassignSession(s.provider, s.sessionId, leg);
                  }}
                >
                  {s.leg === null && <option value="">–</option>}
                  {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <div className="project" title={s.workingDirectory}>
                  {s.projectName}
                </div>
                <div className="cwd">{s.workingDirectory}</div>
              </td>
              <td>
                <span className={`provider provider-${s.provider}`}>{s.provider}</span>
              </td>
              <td>
                <span className={`state state-${s.state}`}>{STATE_LABELS[s.state] ?? s.state}</span>
              </td>
              <td className="when">{relativeTime(s.lastEventAt)}</td>
              <td>
                <button
                  className="ghost"
                  title="Clear this session and free its leg"
                  onClick={() => void clearSession(s.provider, s.sessionId)}
                >
                  ✕
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
