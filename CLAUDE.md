# CLAUDE.md

Travianet voicebot demo: AudioCodes LiveHub AI Agents (Gemini 3.1 Flash Live, German) + mock booking backend. See README.md for the full picture.

## Commands

```bash
npm test                                   # backend (vitest) + offline LiveHub manifest checks
npm --prefix backend run dev               # backend on :8080 (LOG_PRETTY, no API key)
npm --prefix backend run typecheck
node livehub/provision.mjs --lang de       # push agents/tools/test suite to LiveHub (needs .env)
node livehub/chat.mjs --scenario <name>    # scripted chat against the live bot
```

## Layout

- `backend/src/app.ts` – public/voicebot routes; `src/admin.ts` – admin API; `public/admin.html` – booking web interface at /admin (plain HTML/JS, no build); `lib/outbox.ts` – simulated emails (no real sending) + payment links; `lib/store.ts` – in-memory state, verification/retry policy, fees; `lib/normalize.ts` – spoken digit/date parsing; `data/seed.ts` – demo data (fixed dates).
- `livehub/topology.mjs` – agents, their tools and sub-agents (language independent); `tools.mjs` – REST tools; `locales/<lang>/` – prompts, welcome, test suite; `build-manifest.mjs` renders, `provision.mjs` applies via the LiveHub MCP API.

## Rules

- `livehub/` is the source of truth for LiveHub; `apply` replaces entities wholesale. Never edit agents only in the LiveHub UI.
- Prompt templates: `[[common]]`, `[[welcome]]`, `[[agent:<key>]]` are rendered at build time; `{name}` are LiveHub variables. Don't put literal curly braces in prompts.
- Gemini Live calls `end_call`/`transfer_call` without speaking first: calls end via `end_call_detection` ("Auf Wiederhören"), transfers are announced in a separate turn and executed after the caller agrees. Keep it that way.
- The LLM must never validate TIS-ID/PLZ/date itself – the backend normalises and decides (`next_action`).
- If a tool URL changes, the manifest test checks it against the routes in `backend/src/app.ts`.
