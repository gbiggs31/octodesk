import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { Engine } from "./engine.js";
import { Store } from "./store.js";

const config = loadConfig();
const store = new Store(config.dbPath);
const engine = new Engine(store, config);
const app = buildApp(engine);

const expiry = setInterval(() => engine.expireStale(), 60_000);

app.listen({ port: config.port, host: "127.0.0.1" }).then((address) => {
  console.log(`octodesk daemon listening on ${address}`);
  console.log(`db: ${config.dbPath}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(expiry);
    void app.close().then(() => {
      store.close();
      process.exit(0);
    });
  });
}
