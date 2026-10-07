import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { logger } from "./lib/logger.js";
import { Store } from "./lib/store.js";

const config = loadConfig();
const store = new Store(config);
const app = createApp({ config, store });

if (!config.apiKey) logger.warn("API_KEY is not set - the API is open to anyone who can reach it");

app.listen(config.port, () => {
  logger.info({ port: config.port }, "travianet-api listening");
});
