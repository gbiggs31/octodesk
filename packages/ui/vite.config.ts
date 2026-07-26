import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4521,
    proxy: {
      // Daemon owns all state; the UI is a pure view over /api.
      "/api": { target: "http://127.0.0.1:4520" },
    },
  },
});
