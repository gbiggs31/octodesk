# octodesk 🐙

An ambient desktop octopus for AI coding sessions. Eight illuminated, clickable
legs — one per session — and a head that shows the highest-priority state across
all of them. This repo is the software-only MVP: a local daemon, a virtual
octopus dashboard, and a Claude Code hook adapter. A USB serial device speaking
the same protocol comes later.

## Leg colours

| Light | Meaning |
| --- | --- |
| Off | Leg unassigned |
| Dim white | Assigned, idle (or ended — press to resume) |
| Pulsing green | Agent is working |
| Pulsing yellow | Agent needs input or permission |
| Solid blue | Agent finished, awaiting review |
| Flashing red | Session blocked / process failed |

Head priority: error > needs input > completed > working > idle. Pressing the
head targets the oldest session in the top class; repeated presses cycle.

## Quick start

```bash
npm install
npm run dev:daemon     # Fastify daemon on http://127.0.0.1:4520
npm run dev:ui         # dashboard on http://localhost:4521
```

Open the dashboard and use the **Simulator** panel to drive fake sessions
through their lifecycle.

### Track real Claude Code sessions

```bash
npm run install-hooks         # dry-run: shows what would change
npm run install-hooks -- --write   # applies (backs up ~/.claude/settings.json)
```

Every Claude Code session (new ones — restart running sessions) then reports
state via hooks. The shim (`octo-event`) posts to the daemon with a hard
timeout and always exits 0, so Claude behaves identically when the daemon is
down. No prompts, transcripts or source code are ever collected — only session
id, working directory and lifecycle events.

### Launch sessions with `octo` (window focusing)

```bash
npm run link-cli      # once: puts `octo` and `octo-event` on your PATH
octo claude           # instead of `claude`, in any project directory
```

The wrapper captures the terminal window you launched from, so pressing that
session's leg (or the head) brings the right window to the foreground. If the
terminal has been closed, the press reopens the session instead:
a new Windows Terminal window runs `octo claude --resume <session-id>` in the
saved working directory, and the session keeps its leg. Sessions started with
plain `claude` are still tracked — they just can't be focused until ended,
after which pressing their leg resumes them into a managed window.

The wrapper also reports the agent's exit: an unexpected non-zero exit while a
session looked alive is what turns a leg red.

One terminal window per session works best — focusing targets windows, not
tabs. Set `OCTODESK_FOCUS=0` to disable focusing entirely.

## Architecture

```
packages/core     pure state logic: state machine, leg allocation, head
                  priority, light rendering + serial encoding (zero deps)
packages/daemon   Fastify + node:sqlite persistence + SSE stream
packages/ui       React/Vite virtual octopus dashboard
packages/cli      octo-event hook shim + install-hooks
```

The daemon owns all state. Every consumer — the virtual octopus and the future
USB device — renders the same `DeviceCommand` frames (`LEG 1 YELLOW PULSE`,
`HEAD RED FLASH`, …), so hardware support is one more subscriber, not a rewrite.

- DB lives at `%LOCALAPPDATA%\octodesk\octodesk.db` (override: `OCTODESK_DB`)
- Daemon port `4520` (override: `OCTODESK_PORT`)
- Ended sessions free their leg after 4 h (`OCTODESK_ENDED_TTL_MIN`); anything
  silent for 48 h expires (`OCTODESK_STALE_TTL_MIN`)

## API

| Route | Purpose |
| --- | --- |
| `POST /api/events` | normalised `SessionEvent` from any adapter |
| `GET /api/sessions` | current snapshot (sessions, device frame, serial preview) |
| `GET /api/stream` | SSE: snapshot on every change |
| `POST /api/press` | `{target:"head"}` or `{target:"leg", leg:n}` → focuses/resumes |
| `POST /api/sessions/clear` | `{provider, sessionId}` |
| `POST /api/sessions/reassign` | `{provider, sessionId, leg}` |
| `POST /api/wrappers` | `octo` registration: `{wrapId, pid, windowHandle, workingDirectory}` |
| `POST /api/wrappers/exit` | `{wrapId, exitCode}` when the wrapped agent exits |

## Tests

```bash
npm test          # state machine, leg allocation, head priority, HTTP, persistence
npm run typecheck
```

## Roadmap

- **Phase 2 (done)** — `octo claude` wrapper (window correlation via
  `OCTO_WRAP_ID`), window focusing, click-to-resume, crash detection via
  wrapper exit reports
- **Phase 3** — USB serial adapter + firmware speaking the existing protocol;
  Codex adapter if wanted

### Known limitations

- Windows + Windows Terminal only (by design, for now)
- Focusing brings the captured *window* forward; if a session lives in a
  background tab of a shared window, the right window rises but not the tab
- A failed resume (e.g. the agent can't find the saved session) currently
  leaves the pressed session unchanged rather than marking it red — the new
  terminal shows the agent's error and closes
