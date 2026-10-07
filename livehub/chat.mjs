#!/usr/bin/env node
/**
 * Scripted text chat against a LiveHub agent - for quick regression checks of the
 * conversation flow (text chat uses audio transcription for Gemini Live, so replies
 * take a few seconds each).
 *
 *   node livehub/chat.mjs --agent trv-de-main "Ich habe eine Buchung" "1 2 3 4 5 6 7 8" "10117" "15. Juli 2027"
 *   node livehub/chat.mjs --scenario happy-path      (scenarios from locales/<lang>/chat-scenarios.json)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveHub, loadDotEnv } from "./lib/mcp.mjs";
import { parseArgs } from "./build-manifest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
await loadDotEnv(join(here, "..", ".env"));

const args = parseArgs(process.argv.slice(2));
const lang = args.lang || "de";
let agent = args.agent || `trv-${lang}-main`;
const VALUE_FLAGS = new Set(["--agent", "--lang", "--scenario"]);
let turns = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !VALUE_FLAGS.has(all[i - 1]));

if (args.scenario) {
  const scenarios = JSON.parse(readFileSync(join(here, "locales", lang, "chat-scenarios.json"), "utf8"));
  const s = scenarios[args.scenario];
  if (!s) throw new Error(`Unknown scenario. Available: ${Object.keys(scenarios).join(", ")}`);
  turns = s.turns;
  agent = s.agent ?? agent;
}

function print(activities) {
  for (const a of activities ?? []) {
    if (a.type === "message") console.log(`  BOT  : ${a.text}`);
    else if (a.category === "tool_call") console.log(`  [${a.label}] ${a.text.replace(/\s+/g, " ").slice(0, 400)}`);
    else if (a.category === "task_switch" || /switch|send_message/i.test(a.label ?? "")) console.log(`  [${a.label}] ${a.text.replace(/\s+/g, " ").slice(0, 300)}`);
    else if (args.verbose) console.log(`  [${a.label}] ${String(a.text).replace(/\s+/g, " ").slice(0, 300)}`);
  }
}

const lh = await new LiveHub().connect();
const started = await lh.call("start_chat", { agent });
const id = started.conversation_id;
console.log(`conversation ${id} with ${agent}`);
print(started.activities);
for (const text of turns) {
  console.log(`  USER : ${text}`);
  const t0 = Date.now();
  const reply = await lh.call("send_chat_message", { conversation_id: id, text });
  print(reply.activities);
  if (args.verbose) console.log(`  (${Date.now() - t0} ms)`);
}
await lh.call("end_chat", { conversation_id: id });
console.log(`ended - inspect with get_conversation("${id}")`);
