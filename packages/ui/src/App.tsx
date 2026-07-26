import { useState } from "react";
import { press } from "./api.js";
import { Octopus } from "./Octopus.js";
import { SessionList } from "./SessionList.js";
import { Simulator } from "./Simulator.js";
import { useSnapshot } from "./useSnapshot.js";

export function App() {
  const { snapshot, connected } = useSnapshot();
  const [toast, setToast] = useState<string | null>(null);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2600);
  }

  async function handlePress(target: "head" | "leg", leg?: number) {
    const result = await press(target, leg);
    if (result.ok && result.session) {
      // Phase 1 selects/highlights; Phase 2 will focus or resume the real terminal window.
      showToast(`Selected ${result.session.projectName} (${result.session.provider})`);
    } else {
      showToast(result.reason ?? "Nothing there");
    }
  }

  const selectedLeg =
    snapshot?.sessions.find(
      (s) =>
        s.provider === snapshot.selected?.provider &&
        s.sessionId === snapshot.selected?.sessionId,
    )?.leg ?? null;

  return (
    <div className="layout">
      <header>
        <h1>
          octodesk <span className="tagline">ambient coding-session monitor</span>
        </h1>
        <span className={`conn ${connected ? "on" : "off"}`}>
          {connected ? "daemon connected" : "daemon offline"}
        </span>
      </header>

      <main>
        <section className="card octopus-card">
          <Octopus
            frame={snapshot?.frame ?? []}
            selectedLeg={selectedLeg}
            onPress={(t, l) => void handlePress(t, l)}
          />
          {toast && <div className="toast">{toast}</div>}
        </section>

        <div className="side">
          <section className="card">
            <h2>Sessions</h2>
            <SessionList sessions={snapshot?.sessions ?? []} selected={snapshot?.selected ?? null} />
          </section>

          <section className="card">
            <h2>Simulator</h2>
            <Simulator sessions={snapshot?.sessions ?? []} />
          </section>

          <section className="card">
            <h2>Device protocol</h2>
            <pre className="serial">{(snapshot?.serial ?? []).join("\n")}</pre>
          </section>
        </div>
      </main>
    </div>
  );
}
