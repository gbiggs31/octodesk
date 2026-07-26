import Fastify, { type FastifyInstance } from "fastify";
import type { AgentProvider, SessionEvent, SessionEventType } from "@octodesk/core";
import type { Engine, PressTarget } from "./engine.js";
import type { FocusService } from "./focus.js";

const PROVIDERS: ReadonlySet<string> = new Set(["claude", "codex"] satisfies AgentProvider[]);
const EVENT_TYPES: ReadonlySet<string> = new Set([
  "session_started",
  "working",
  "permission_requested",
  "input_requested",
  "completed",
  "error",
  "session_ended",
  "heartbeat",
] satisfies SessionEventType[]);

/** Build the Fastify app around an engine; the entry point and tests share this. */
export function buildApp(engine: Engine, focus?: FocusService): FastifyInstance {
  const app = Fastify({ logger: false });

  // Generic event receiver: adapters, the simulator and future integrations all post here.
  app.post("/api/events", (req, reply) => {
    const body = req.body as Partial<SessionEvent> | null;
    const problem = validateEvent(body);
    if (problem) return reply.code(400).send({ ok: false, error: problem });
    engine.applyEvent({
      provider: body!.provider as AgentProvider,
      sessionId: body!.sessionId!,
      workingDirectory: body!.workingDirectory ?? "",
      event: body!.event as SessionEventType,
      timestamp: body!.timestamp ?? new Date().toISOString(),
      wrapId: typeof body!.wrapId === "string" ? body!.wrapId : undefined,
    });
    return { ok: true };
  });

  app.get("/api/sessions", () => engine.snapshot());

  // Server-Sent Events: full snapshot on connect and on every change.
  app.get("/api/stream", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const send = (snap: unknown) => reply.raw.write(`data: ${JSON.stringify(snap)}\n\n`);
    send(engine.snapshot());
    const unsubscribe = engine.onChange(send);
    req.raw.on("close", unsubscribe);
  });

  app.post("/api/press", async (req, reply) => {
    const body = req.body as { target?: string; leg?: number } | null;
    let target: PressTarget;
    if (body?.target === "head") {
      target = { type: "head" };
    } else if (body?.target === "leg" && Number.isInteger(body.leg)) {
      target = { type: "leg", leg: body.leg! };
    } else {
      return reply.code(400).send({ ok: false, error: "target must be 'head' or 'leg' with a leg number" });
    }
    const result = engine.press(target);
    if (!result.ok || !result.session || !focus) {
      return reply.code(result.ok ? 200 : 404).send(result);
    }
    // Physical half of the press: focus the terminal or resume the session.
    const outcome = await focus.act(result.session, engine.wrapperFor(result.session));
    if (outcome.action === "failed") {
      engine.markError(
        result.session.provider,
        result.session.sessionId,
        outcome.detail ?? "focus/resume failed",
      );
    }
    return reply.send({ ...result, action: outcome.action, detail: outcome.detail });
  });

  // `octo` wrapper lifecycle: registration at launch, exit report at agent death.
  app.post("/api/wrappers", (req, reply) => {
    const body = req.body as {
      wrapId?: string;
      pid?: number;
      windowHandle?: string | null;
      workingDirectory?: string;
    } | null;
    if (!body?.wrapId || typeof body.pid !== "number") {
      return reply.code(400).send({ ok: false, error: "wrapId and pid required" });
    }
    engine.registerWrapper({
      wrapId: body.wrapId,
      pid: body.pid,
      windowHandle: typeof body.windowHandle === "string" ? body.windowHandle : null,
      workingDirectory: body.workingDirectory ?? "",
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  });

  app.post("/api/wrappers/exit", (req, reply) => {
    const body = req.body as { wrapId?: string; exitCode?: number } | null;
    if (!body?.wrapId) return reply.code(400).send({ ok: false, error: "wrapId required" });
    engine.wrapperExit(body.wrapId, typeof body.exitCode === "number" ? body.exitCode : 0);
    return { ok: true };
  });

  app.post("/api/sessions/clear", (req, reply) => {
    const body = req.body as { provider?: string; sessionId?: string } | null;
    if (!body?.provider || !body?.sessionId) {
      return reply.code(400).send({ ok: false, error: "provider and sessionId required" });
    }
    const ok = engine.clear(body.provider, body.sessionId);
    return reply.code(ok ? 200 : 404).send({ ok });
  });

  app.post("/api/sessions/reassign", (req, reply) => {
    const body = req.body as { provider?: string; sessionId?: string; leg?: number } | null;
    if (!body?.provider || !body?.sessionId || typeof body.leg !== "number") {
      return reply.code(400).send({ ok: false, error: "provider, sessionId and leg required" });
    }
    const ok = engine.reassign(body.provider, body.sessionId, body.leg);
    return reply.code(ok ? 200 : 404).send({ ok });
  });

  return app;
}

function validateEvent(body: Partial<SessionEvent> | null): string | null {
  if (!body || typeof body !== "object") return "JSON body required";
  if (typeof body.provider !== "string" || !PROVIDERS.has(body.provider)) {
    return `provider must be one of: ${[...PROVIDERS].join(", ")}`;
  }
  if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
    return "sessionId must be a non-empty string";
  }
  if (typeof body.event !== "string" || !EVENT_TYPES.has(body.event)) {
    return `event must be one of: ${[...EVENT_TYPES].join(", ")}`;
  }
  return null;
}
