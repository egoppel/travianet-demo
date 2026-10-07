#!/usr/bin/env node
/**
 * Creates / updates the Travianet voicebot in LiveHub.
 *
 *   node livehub/provision.mjs --lang de              apply agents + tools (+ test suite)
 *   node livehub/provision.mjs --lang de --dry-run    only print what would be applied
 *   node livehub/provision.mjs --lang de --delete     remove the agents of that language
 *
 * Reads .env from the repository root (see .env.example): LIVEHUB_CLIENT_ID,
 * LIVEHUB_CLIENT_SECRET, TRAVIANET_API_URL, API_KEY, SIKOM_SERVICE_2/3/4.
 * `apply` replaces existing entities with the same name wholesale, so this script
 * is the source of truth: edit the files in livehub/ and re-run it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { LiveHub, loadDotEnv } from "./lib/mcp.mjs";
import { agentName, buildManifest, configFromEnv, loadLocale, parseArgs } from "./build-manifest.mjs";
import { AGENTS } from "./topology.mjs";

const here = dirname(fileURLToPath(import.meta.url));
await loadDotEnv(join(here, "..", ".env"));

const args = parseArgs(process.argv.slice(2));
const lang = args.lang || "de";
const config = configFromEnv();
const { locale } = loadLocale(lang);

if (!config.apiKey) console.warn("WARNING: API_KEY is empty - tools will send an empty X-Api-Key header.");
for (const n of [2, 3, 4]) {
  if (config.sikom[n].startsWith("+49000000000")) console.warn(`WARNING: SIKOM_SERVICE_${n} not set - using placeholder ${config.sikom[n]}`);
}

const manifest = buildManifest({ lang, ...config });

if (args["dry-run"]) {
  console.log(JSON.stringify(manifest, (k, v) => (k === "value" && v ? "***" : v), 2));
  process.exit(0);
}

const lh = await new LiveHub().connect();

if (args.delete) {
  for (const key of Object.keys(AGENTS).reverse()) {
    const name = agentName(locale, key);
    try {
      await lh.call("delete_entity", { kind: "agent", name });
      console.log(`deleted agent ${name}`);
    } catch (e) {
      console.log(`skip ${name}: ${e.message}`);
    }
  }
  process.exit(0);
}

// Agents reference each other in a cycle (booking <-> cancel/rebook). Create them
// first without sub-agents, then apply the full manifest.
const existing = new Set((await lh.call("list_agents", {})).agents.map((a) => a.name));
const missing = manifest.agents.filter((a) => !existing.has(a.name));
if (missing.length) {
  await lh.call("apply", {
    manifest: { tools: manifest.tools, agents: missing.map((a) => ({ ...a, agents: [] })) },
  });
  console.log(`created ${missing.map((a) => a.name).join(", ")}`);
}
const result = await lh.call("apply", { manifest });
console.log("applied:", JSON.stringify(result));

const suitePath = join(here, "locales", lang, "test-suite.json");
try {
  const suite = JSON.parse(readFileSync(suitePath, "utf8"));
  suite.agent = agentName(locale, "main");
  await lh.call("create_or_update_test_suite", { test_suite: suite });
  console.log(`test suite "${suite.name}" updated`);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

console.log(`\nDone. Entry agent: ${agentName(locale, "main")} (connect it to a bot connection / phone number in LiveHub).`);
