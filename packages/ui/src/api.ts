import type {
  AgentProvider,
  DeviceCommand,
  SessionEventType,
  SessionRecord,
  SessionState,
} from "@octodesk/core";

export interface Snapshot {
  sessions: SessionRecord[];
  frame: DeviceCommand[];
  serial: string[];
  head: SessionState | null;
  selected: { provider: string; sessionId: string } | null;
}

export interface PressResponse {
  ok: boolean;
  session?: SessionRecord;
  action?: string;
  reason?: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function sendEvent(
  provider: AgentProvider,
  sessionId: string,
  workingDirectory: string,
  event: SessionEventType,
): Promise<{ ok: boolean }> {
  return post("/api/events", {
    provider,
    sessionId,
    workingDirectory,
    event,
    timestamp: new Date().toISOString(),
  });
}

export function press(target: "head" | "leg", leg?: number): Promise<PressResponse> {
  return post("/api/press", { target, leg });
}

export function clearSession(provider: string, sessionId: string): Promise<{ ok: boolean }> {
  return post("/api/sessions/clear", { provider, sessionId });
}

export function reassignSession(
  provider: string,
  sessionId: string,
  leg: number,
): Promise<{ ok: boolean }> {
  return post("/api/sessions/reassign", { provider, sessionId, leg });
}
