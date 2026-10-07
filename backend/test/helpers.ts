import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { Store } from "../src/lib/store.js";

/** Fixed "today" so fee calculations are reproducible. */
export const NOW = new Date("2026-10-07T09:00:00Z");

export function setup(overrides: Partial<Config> = {}) {
  const config = { ...loadConfig({}), ...overrides };
  const store = new Store(config, () => NOW);
  const app = createApp({ config, store });
  return { app, store, config, api: () => request(app) };
}

export const MAX = { tis_id: "12345678", postal_code: "10117", travel_date: "2027-07-15" };
