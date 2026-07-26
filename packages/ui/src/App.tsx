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
    if (result.action === "launched") {
      showToast(result.detail ?? "Starting a new claude session…");
      return;
    }
    if (!result.ok || !result.session) {
      showToast(result.detail ?? result.reason ?? "Nothing there");
      return;
    }
    const name = `${result.session.projectName} (${result.session.provider})`;
    switch (result.action) {
      case "focused":
        showToast(`Focused ${name}`);
        break;
      case "resumed":
        showToast(`Resuming ${name} in a new terminal…`);
        break;
      case "no_window":
        showToast(result.detail ?? `${name} has no window to focus`);
        break;
      case "failed":
        showToast(`Failed: ${result.detail ?? "could not focus or resume"}`);
        break;
      default:
        showToast(`Selected ${name}`);
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
