/**
 * Offline checks of the generated LiveHub manifest (no network):
 *   node --test livehub/test/manifest.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, loadLocale } from "../build-manifest.mjs";
import { BUILTIN_TOOLS } from "../topology.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const languages = readdirSync(join(here, "..", "locales"));
const config = { baseUrl: "https://api.example.test", apiKey: "k", sikom: { 2: "+492", 3: "+493", 4: "+494" } };

/** Variables LiveHub provides itself (time/date, conversation data). */
const PLATFORM_VARIABLES = new Set(["current_datetime", "current_date", "current_time", "current_day", "conversationId", "caller", "callee"]);

for (const lang of languages) {
  const manifest = buildManifest({ lang, ...config });
  const toolNames = new Set(manifest.tools.map((t) => t.name));
  const agentNames = new Set(manifest.agents.map((a) => a.name));

  test(`[${lang}] agent names are valid LiveHub names`, () => {
    for (const name of agentNames) assert.match(name, /^[A-Za-z0-9 _-]{1,32}$/, name);
  });

  test(`[${lang}] all tool and sub-agent references resolve`, () => {
    for (const a of manifest.agents) {
      for (const t of a.tools_config) {
        if (t.tool === "custom") assert.ok(toolNames.has(t.tool_id), `${a.name}: unknown tool ${t.tool_id}`);
        else assert.ok(BUILTIN_TOOLS.has(t.tool), `${a.name}: unknown builtin ${t.tool}`);
      }
      for (const sub of a.agents) assert.ok(agentNames.has(sub), `${a.name}: unknown sub-agent ${sub}`);
    }
  });

  test(`[${lang}] prompts only mention tools the agent actually has`, () => {
    for (const a of manifest.agents) {
      const available = new Set(a.tools_config.map((t) => t.tool_id ?? t.tool));
      for (const [, tool] of a.prompt.matchAll(/`((?:trv_)[a-z_]+|send_message|pass_question|transfer_call|end_call)`/g)) {
        assert.ok(available.has(tool), `${a.name} prompt mentions ${tool} but the agent does not have it`);
      }
      // speech-to-speech: end_call hangs up without speaking - calls end via end_call_detection
      assert.ok(!available.has("end_call"), `${a.name} should not use end_call`);
      assert.ok(a.advanced_config.end_call_detection.keywords.length > 0);
    }
  });

  test(`[${lang}] templates are fully rendered and variables are defined`, () => {
    for (const a of manifest.agents) {
      assert.ok(!a.prompt.includes("[["), `${a.name}: unrendered template marker`);
      const defined = new Set(a.variables_str.split("\n").map((l) => l.split("=")[0].trim()));
      for (const [, name] of a.prompt.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)[^}]*\}/g)) {
        assert.ok(defined.has(name) || PLATFORM_VARIABLES.has(name), `${a.name}: undefined variable {${name}}`);
      }
    }
  });

  test(`[${lang}] only the entry agent greets, with barge-in protection`, () => {
    const { locale } = loadLocale(lang);
    const [main, ...subs] = manifest.agents;
    assert.equal(main.name, `${locale.agent_prefix}-main`);
    assert.equal(main.welcome.type, "static");
    assert.ok(main.welcome.message.startsWith(locale.welcome_parts[0].message));
    assert.equal(main.advanced_config.welcome_message_barge_in, false);
    assert.equal(main.advanced_config.welcome_message_parts[0].barge_in, false);
    assert.equal(main.advanced_config.gemini_audio.vad_mode, "silero");
    assert.ok(main.advanced_config.inactivity_reminder.timeout > 0);
    for (const s of subs) assert.equal(s.welcome.message, "", `${s.name} must not have its own welcome`);
  });

  test(`[${lang}] transfers are restricted to the Sikom numbers`, () => {
    for (const a of manifest.agents) {
      const transfer = a.tools_config.find((t) => t.tool === "transfer_call");
      if (!transfer) continue;
      assert.equal(transfer.valid_numbers, "+492,+493,+494");
    }
  });
}

test("[de] welcome message is exactly as requested", () => {
  const { locale } = loadLocale("de");
  assert.equal(locale.welcome_parts[0].message, "Guten Tag, ich bin Ihr digitaler Reiseassistent.");
});

test("tools send API key, conversation id and language", () => {
  const { tools } = buildManifest({ lang: "de", ...config });
  for (const t of tools) {
    assert.match(t.headers, /X-Api-Key: \{api_key\}/);
    assert.match(t.headers, /X-Conversation-Id: \{conversationId\}/);
    assert.match(t.headers, /Accept-Language: \{accept_language\}/);
    assert.deepEqual(t.variables, [{ name: "api_key", type: "secret", value: "k" }]);
    assert.equal(t.realtime_async_mode, false);
  }
});

test("every tool URL matches a backend route", () => {
  const app = readFileSync(join(here, "..", "..", "backend", "src", "app.ts"), "utf8");
  const routes = new Set();
  for (const [, router, method, path] of app.matchAll(/\b(v1|booking)\.(get|post)\("([^"]+)"/g)) {
    if (router === "v1") routes.add(`${method.toUpperCase()} /api/v1${path}`);
    else routes.add(`${method.toUpperCase()} /api/v1/booking${path === "/" ? "" : path}`);
  }
  const { tools } = buildManifest({ lang: "de", ...config });
  for (const t of tools) {
    const path = new URL(t.url).pathname;
    assert.ok(routes.has(`${t.method} ${path}`), `${t.name}: ${t.method} ${path} is not a backend route`);
  }
});
