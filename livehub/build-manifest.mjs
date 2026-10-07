#!/usr/bin/env node
/**
 * Renders the LiveHub manifest (agents + tools) for one language.
 *
 *   node livehub/build-manifest.mjs --lang de            -> prints the manifest JSON
 *   node livehub/build-manifest.mjs --lang de --out file
 *
 * Prompt templates (locales/<lang>/prompts/*.md) support:
 *   [[common]]        shared guardrails from _common.md
 *   [[welcome]]       the full welcome text from locale.json
 *   [[agent:<key>]]   name of another agent of the same language, e.g. [[agent:auth]]
 * Everything in {curly braces} is a LiveHub variable and is left untouched.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, BUILTIN_TOOLS, MODEL } from "./topology.mjs";
import { buildTools } from "./tools.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function loadLocale(lang) {
  const dir = join(here, "locales", lang);
  const locale = JSON.parse(readFileSync(join(dir, "locale.json"), "utf8"));
  const prompt = (key) => readFileSync(join(dir, "prompts", `${key}.md`), "utf8").trim();
  return { locale, prompt };
}

export function agentName(locale, key) {
  return `${locale.agent_prefix}-${key}`;
}

export function welcomeText(locale) {
  return locale.welcome_parts.map((p) => p.message).join(" ");
}

export function renderPrompt(template, { locale, common }) {
  return template
    .replaceAll("[[common]]", common)
    .replaceAll("[[welcome]]", welcomeText(locale))
    .replace(/\[\[agent:([a-z]+)\]\]/g, (_, key) => {
      if (!AGENTS[key]) throw new Error(`Unknown agent reference [[agent:${key}]]`);
      return agentName(locale, key);
    });
}

function variables(locale, sikom) {
  return [
    "timezone = Europe/Berlin",
    `accept_language = ${locale.accept_language}`,
    `sikom_service_2 = ${sikom[2]}`,
    `sikom_service_3 = ${sikom[3]}`,
    `sikom_service_4 = ${sikom[4]}`,
  ].join("\n");
}

/** Speech-to-speech settings. In a multi-agent topology the main agent's model and audio session serve the whole call. */
function realtimeConfig(locale) {
  return {
    gemini_audio: {
      voice: locale.gemini_voice,
      // Gemini's built-in VAD sporadically "freezes" (more often for non-English speech):
      // the model then never answers -> long silences. Silero VAD avoids that and is
      // also required for the inactivity reminder below.
      vad_mode: "silero",
    },
    silero_vad: {
      // ignore short noises/clicks on the line as speech starts
      min_speech_ms: 250,
      redemption_ms: 700,
    },
    // If the caller stays silent, nudge the model to re-ask instead of waiting forever.
    inactivity_reminder: {
      timeout: 7000,
      text: locale.inactivity_reminder_text,
      repeat: 3,
    },
    // Line noise or an early "hallo" must not cut the welcome off after "Guten Tag".
    welcome_message_barge_in: false,
    welcome_message_parts: locale.welcome_parts,
    // Open the model session while the call is being set up.
    establish_llm_connection: true,
    max_turns_message: locale.max_turns_message,
  };
}

export function buildManifest({ lang = "de", baseUrl, apiKey, sikom }) {
  const { locale, prompt } = loadLocale(lang);
  const common = prompt("_common");
  const numbers = Object.values(sikom).join(",");

  const agents = Object.entries(AGENTS).map(([key, def]) => {
    const tools_config = def.tools.map((tool) => {
      if (!BUILTIN_TOOLS.has(tool)) return { tool: "custom", tool_id: tool };
      if (tool === "transfer_call") {
        // With a default number the LLM cannot choose the destination itself.
        const service = def.transferDefault ? Number(def.transferDefault.split("_").pop()) : null;
        return { tool, default_number: service ? sikom[service] : "", valid_numbers: numbers, wait_result: false, default_message: "" };
      }
      if (tool === "end_call") return { tool, default_message: "" };
      return { tool };
    });

    return {
      name: agentName(locale, key),
      description: locale.agents[key],
      llm: MODEL,
      temperature: 0.3,
      max_tokens: 2048,
      max_turns: 60,
      prompt: renderPrompt(prompt(key), { locale, common }),
      welcome: key === "main" ? { type: "static", message: welcomeText(locale) } : { type: "static", message: "" },
      tools_config,
      agents: def.subAgents.map((k) => agentName(locale, k)),
      orchestration_mode: "delegate",
      variables_str: variables(locale, sikom),
      error_message: locale.error_message,
      logs: "enabled",
      advanced_config: {
        explicit_tool_errors: true,
        // Gemini Live calls end_call without speaking first. Instead the agent says its
        // farewell ("... Auf Wiederhören.") and the platform hangs up after playing it.
        end_call_detection: { keywords: locale.end_call_keywords, last_sentence: true },
        ...(key === "main" ? realtimeConfig(locale) : {}),
      },
    };
  });

  return { tools: buildTools({ baseUrl, apiKey }), agents };
}

export function configFromEnv(env = process.env) {
  const missing = (n) => `+49000000000${n}`; // placeholder until Sikom provides the targets
  return {
    baseUrl: env.TRAVIANET_API_URL || "https://travianet.voiceaidemo.avvid.nl",
    apiKey: env.API_KEY || "",
    sikom: {
      2: env.SIKOM_SERVICE_2 || missing(2),
      3: env.SIKOM_SERVICE_3 || missing(3),
      4: env.SIKOM_SERVICE_4 || missing(4),
    },
  };
}

const VALUE_FLAGS = new Set(["lang", "out", "agent", "scenario"]);

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = VALUE_FLAGS.has(key) && argv[i + 1] ? argv[++i] : true;
    }
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildManifest({ lang: args.lang || "de", ...configFromEnv() });
  // never print the API key
  const json = JSON.stringify(manifest, (k, v) => (k === "value" && v ? "***" : v), 2);
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, json);
    console.error(`wrote ${args.out}`);
  } else {
    console.log(json);
  }
}
