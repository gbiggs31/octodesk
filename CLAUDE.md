# octodesk — project context

Ambient desktop octopus (8 clickable lit legs + head) mirroring the state of
concurrent AI coding sessions. Goal: a real-world-usable prototype, eventually
a simple physical USB device that could be sold — not a big business.

## Current state (2026-07-26)

Phases 1 & 2 complete and in daily use:

- **core** — pure logic: state machine, leg allocation (reclaim, waiting list,
  2-min press-to-launch reservations), head priority + press cycling, light
  rendering + serial text encoding (`LEG 1 GREEN PULSE`, `HEAD RED FLASH`)
- **daemon** — Fastify on 127.0.0.1:4520, `node:sqlite` DB in
  `%LOCALAPPDATA%\octodesk`, SSE stream, TTL expiry; press → Win32 focus
  (SetForegroundWindow/SwitchToThisWindow via PowerShell), click-to-resume and
  press-empty-leg-to-launch via `wt -d <dir> node octo.js claude [...]`
- **ui** — React/Vite dashboard on 4521 (dev), SVG octopus, session list,
  simulator, serial preview
- **cli** — `octo claude` wrapper (captures foreground HWND at launch,
  injects OCTO_WRAP_ID/OCTO_RESUME_OF, reports agent exit → red legs) and
  `octo-event` hook shim (fail-silent, always exit 0). Both globally linked
  via `npm run link-cli`. Claude Code hooks installed in
  `~/.claude/settings.json` (install-hooks script, backup kept)

89 tests (`npm test`), `npm run typecheck`. TS7 / Vite 8 / vitest 4 — keep
the UI's vite major aligned with vitest's bundled vite or the dev server
breaks (rolldown "Missing field moduleType" error).

Colours (user-chosen): green pulse=working, yellow pulse=needs input,
blue solid=done, red flash=error, white dim=idle/ended, off=unassigned.
Head shows highest priority: error > needs_input > completed > working > idle.

## Decisions & constraints

- Windows + Windows Terminal only for now, by design
- Codex CLI dropped for MVP (user choice); `AgentProvider` union and adapter
  seam retained. Codex now has Claude-style hooks.json per third-party docs —
  re-verify against the official repo before building that adapter
- Companion app = **desktop** (explicitly not mobile; no Wi-Fi/BT/cloud)
- No prompts/transcripts/source ever collected — session id, cwd, lifecycle only
- User is currently dogfooding; collect friction reports before big changes

## Known limitations

- Focus raises the captured *window*, not a specific WT tab (recommend one
  window per session)
- Failed resume (agent can't find saved session) leaves the pressed session
  unchanged — the error only shows in the transient terminal
- PostToolUse hook spawns node per tool call (~60–100 ms); drop it if lag
  annoys (cost: needs_input→working recovery waits for Stop)
- PowerShell pipes add a UTF-8 BOM — octo-event strips it (keep doing so)

## Next steps (agreed roadmap)

Track 1 — desktop companion app:
1. Single `octodesk` command: Fastify serves the built UI statically
   (dist exists via `npm run build -w @octodesk/ui`) — one process, no vite dev
2. Auto-start on login (Startup shortcut or Task Scheduler; an
   `octodesk install-startup` command)
3. Tray icon only if dogfooding shows it's missed (Tauri/Electron — resist)
4. Codex adapter when user installs Codex

Track 2 — physical prototype (develops separately):
1. Serial driver in daemon: `serialport` subscriber streaming the existing
   DeviceCommand text frames; parse `PRESS LEG n` / `PRESS HEAD` into
   engine.press(). Plus a terminal device-emulator for testing without hardware
2. Breadboard: Raspberry Pi Pico (USB CDC) + 9× WS2812B + 9 buttons;
   MicroPython firmware parses lines, animates pulse/flash locally, emits
   presses. Protocol frames already animate device-side by design
3. 3D-printed translucent octopus enclosure, legs as light pipes
4. Sellable version much later: custom PCB, USB-C, capacitive legs; EMC
   compliance (CE/UKCA/FCC) needed to sell — keep electronics simple

Recommended first build on return: Track 2 step 1 + Track 1 step 1 (both pure
software, small, and make hardware day plug-and-play).

## Dev commands

```bash
npm run dev:daemon    # tsx watch, port 4520 (OCTODESK_PORT)
npm run dev:ui        # vite, port 4521, proxies /api
npm test              # vitest, all packages
npm run typecheck
npm run build:cli     # required before hooks/octo work (dist/)
npm run link-cli      # global octo + octo-event (run from repo root)
npm run install-hooks -- --write   # re-register Claude Code hooks
```

Env: `OCTODESK_PORT`, `OCTODESK_DB`, `OCTODESK_FOCUS=0` (disable focusing),
`OCTODESK_NEW_SESSION_DIR` (where empty-leg-press sessions start),
`OCTODESK_ENDED_TTL_MIN` (default 240), `OCTODESK_STALE_TTL_MIN` (default 2880).
