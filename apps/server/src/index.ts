import { loadConfig, ConfigError } from "./config";
import { createLogger } from "./log";
import { createApp } from "./app";

const [command = "serve"] = Bun.argv.slice(2);
const log = createLogger();

if (command === "serve") {
  let config;
  try {
    config = loadConfig(Bun.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      log.error("config", { message: e.message });
      process.exit(2);
    }
    throw e;
  }
  const app = createApp({ config, log, health: () => true });
  Bun.serve({ port: config.port, hostname: "0.0.0.0", fetch: app.fetch });
  log.info("listening", { port: config.port, data_dir: config.dataDir });
} else {
  log.error("unknown command", { command });
  process.exit(2);
}
