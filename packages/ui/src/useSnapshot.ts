import { useEffect, useState } from "react";
import type { Snapshot } from "./api.js";

/** Live snapshot over SSE; EventSource reconnects automatically when the daemon restarts. */
export function useSnapshot(): { snapshot: Snapshot | null; connected: boolean } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.onmessage = (e) => {
      setConnected(true);
      setSnapshot(JSON.parse(e.data) as Snapshot);
    };
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  return { snapshot, connected };
}
