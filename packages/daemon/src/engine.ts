import { basename } from "node:path";
import {
  allocateLeg,
  deviceFrame,
  encodeCommand,
  firstFreeLeg,
  headState,
  nextHeadTarget,
  nextWaitingSession,
  transition,
  LEG_COUNT,
  type DeviceCommand,
  type SessionEvent,
  type SessionRecord,
  type SessionState,
  type WrapperInfo,
} from "@octodesk/core";
import type { DaemonConfig } from "./config.js";
import type { Store } from "./store.js";

export interface Snapshot {
  sessions: SessionRecord[];
  /** Light instructions, identical shape for the virtual UI and future serial device. */
  frame: DeviceCommand[];
  /** The same frame in the future USB serial text encoding, for the protocol preview. */
  serial: string[];
  head: SessionState | null;
  /** Session most recently targeted by a press, for UI highlight (focus lands in Phase 2). */
  selected: { provider: string; sessionId: string } | null;
}

export type PressTarget = { type: "head" } | { type: "leg"; leg: number };

export interface PressResult {
  ok: boolean;
  session?: SessionRecord;
  /** Phase 1: "select" (highlight in UI). Phase 2 adds "focus" and "resume". */
  action?: "select";
  reason?: string;
}

/** Orchestrates the pure core logic against the store, and notifies SSE listeners. */
/** How long a pressed empty leg stays reserved for the session it launched. */
const LEG_RESERVATION_MS = 120_000;

export class Engine {
  private records = new Map<string, SessionRecord>();
  private wrappers = new Map<string, WrapperInfo>();
  private pendingLeg: { leg: number; at: number } | null = null;
  private headCursor: string | null = null;
  private selected: { provider: string; sessionId: string } | null = null;
  private listeners = new Set<(snap: Snapshot) => void>();

  constructor(
    private store: Store,
    private config: Pick<DaemonConfig, "endedTtlMs" | "staleTtlMs">,
  ) {
    for (const r of store.loadAll()) this.records.set(key(r.provider, r.sessionId), r);
    for (const w of store.loadWrappers()) this.wrappers.set(w.wrapId, w);
  }

  onChange(fn: (snap: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private all(): SessionRecord[] {
    return [...this.records.values()];
  }

  snapshot(): Snapshot {
    const sessions = this.all().sort(
      (a, b) => (a.leg ?? LEG_COUNT + 1) - (b.leg ?? LEG_COUNT + 1) || a.createdAt.localeCompare(b.createdAt),
    );
    const frame = deviceFrame(sessions);
    return {
      sessions,
      frame,
      serial: frame.map(encodeCommand),
      head: headState(sessions),
      selected: this.selected,
    };
  }

  applyEvent(ev: SessionEvent, now: string = new Date().toISOString()): void {
    const k = key(ev.provider, ev.sessionId);
    const existing = this.records.get(k);
    const next = transition(existing?.state, ev.event);

    if (!existing) {
      // A resume that minted a fresh session id inherits the old session's leg.
      let inheritedLeg: number | null = null;
      if (ev.resumeOf && ev.resumeOf !== ev.sessionId) {
        const old = this.records.get(key(ev.provider, ev.resumeOf));
        if (old) {
          inheritedLeg = old.leg;
          this.records.delete(key(ev.provider, ev.resumeOf));
          this.store.remove(ev.provider, ev.resumeOf);
        }
      }
      // A press on an empty leg reserves it for the session it launched.
      let reservedLeg: number | null = null;
      if (
        this.pendingLeg &&
        Date.parse(now) - this.pendingLeg.at < LEG_RESERVATION_MS &&
        !this.all().some((r) => r.leg === this.pendingLeg!.leg)
      ) {
        reservedLeg = this.pendingLeg.leg;
        this.pendingLeg = null;
      }
      const record: SessionRecord = {
        leg: inheritedLeg ?? reservedLeg ?? allocateLeg(this.all(), null),
        provider: ev.provider,
        sessionId: ev.sessionId,
        workingDirectory: ev.workingDirectory,
        projectName: basename(ev.workingDirectory) || ev.workingDirectory,
        state: next ?? "idle",
        createdAt: now,
        lastEventAt: now,
        wrapId: ev.wrapId ?? null,
      };
      this.records.set(k, record);
      this.store.upsert(record);
    } else {
      existing.lastEventAt = now;
      if (next !== null) {
        existing.state = next;
        if (next !== "error") existing.note = null; // recovery clears the explanation
      }
      if (ev.wrapId) existing.wrapId = ev.wrapId;
      if (ev.workingDirectory) {
        existing.workingDirectory = ev.workingDirectory;
        existing.projectName = basename(ev.workingDirectory) || ev.workingDirectory;
      }
      // A session that lost its leg (waiting list / cleared) gets one on resume.
      if (existing.leg === null && existing.state !== "ended") {
        existing.leg = allocateLeg(this.all(), null);
      }
      this.store.upsert(existing);
    }
    this.broadcast();
  }

  /** Reserve an empty leg for the next brand-new session (press-to-launch). */
  reserveLeg(leg: number, at: number = Date.now()): void {
    this.pendingLeg = { leg, at };
  }

  registerWrapper(info: WrapperInfo): void {
    this.wrappers.set(info.wrapId, info);
    this.store.upsertWrapper(info);
  }

  wrapperFor(session: SessionRecord): WrapperInfo | undefined {
    return session.wrapId ? this.wrappers.get(session.wrapId) : undefined;
  }

  /**
   * The wrapper reports its agent's exit. A non-zero exit while the session
   * looked alive is the "process/integration failed" red the brief reserves
   * for genuine breakage; a clean exit just marks the session ended.
   */
  wrapperExit(wrapId: string, exitCode: number): void {
    this.wrappers.delete(wrapId);
    this.store.removeWrapper(wrapId);
    const session = this.all().find((r) => r.wrapId === wrapId);
    if (!session || session.state === "ended") {
      this.broadcast();
      return;
    }
    if (exitCode !== 0 && session.state !== "completed") {
      session.state = "error";
      session.note = `Agent exited unexpectedly (code ${exitCode})`;
    } else {
      session.state = "ended";
    }
    session.lastEventAt = new Date().toISOString();
    this.store.upsert(session);
    this.broadcast();
  }

  markError(provider: string, sessionId: string, note: string): void {
    const record = this.records.get(key(provider, sessionId));
    if (!record) return;
    record.state = "error";
    record.note = note;
    record.lastEventAt = new Date().toISOString();
    this.store.upsert(record);
    this.broadcast();
  }

  press(target: PressTarget): PressResult {
    if (target.type === "leg") {
      const session = this.all().find((r) => r.leg === target.leg);
      if (!session) return { ok: false, reason: `Leg ${target.leg} is unassigned` };
      this.selected = { provider: session.provider, sessionId: session.sessionId };
      this.broadcast();
      return { ok: true, session, action: "select" };
    }
    const session = nextHeadTarget(this.all(), this.headCursor);
    if (!session) return { ok: false, reason: "No active sessions" };
    this.headCursor = session.sessionId;
    this.selected = { provider: session.provider, sessionId: session.sessionId };
    this.broadcast();
    return { ok: true, session, action: "select" };
  }

  clear(provider: string, sessionId: string): boolean {
    const k = key(provider, sessionId);
    if (!this.records.has(k)) return false;
    this.records.delete(k);
    this.store.remove(provider, sessionId);
    if (this.selected?.provider === provider && this.selected?.sessionId === sessionId) {
      this.selected = null;
    }
    this.promoteWaiting();
    this.broadcast();
    return true;
  }

  /** Manual reassignment; if the target leg is occupied the two sessions swap legs. */
  reassign(provider: string, sessionId: string, leg: number): boolean {
    if (!Number.isInteger(leg) || leg < 1 || leg > LEG_COUNT) return false;
    const record = this.records.get(key(provider, sessionId));
    if (!record) return false;
    const occupant = this.all().find((r) => r.leg === leg);
    if (occupant && occupant !== record) {
      occupant.leg = record.leg;
      this.store.upsert(occupant);
    }
    record.leg = leg;
    this.store.upsert(record);
    this.broadcast();
    return true;
  }

  /** Drop ended sessions past their TTL and anything stale past the hard TTL. */
  expireStale(nowMs: number = Date.now()): void {
    let changed = false;
    for (const [k, r] of this.records) {
      const age = nowMs - Date.parse(r.lastEventAt);
      const ttl = r.state === "ended" ? this.config.endedTtlMs : this.config.staleTtlMs;
      if (age > ttl) {
        this.records.delete(k);
        this.store.remove(r.provider, r.sessionId);
        changed = true;
      }
    }
    if (changed) {
      this.promoteWaiting();
      this.broadcast();
    }
  }

  private promoteWaiting(): void {
    for (;;) {
      const waiting = nextWaitingSession(this.all());
      if (!waiting) return;
      const leg = firstFreeLeg(this.all());
      if (leg === null) return;
      waiting.leg = leg;
      this.store.upsert(waiting);
    }
  }
}

function key(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`;
}
