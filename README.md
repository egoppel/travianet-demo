# Travianet LiveHub Voicebot Demo

MVP of a German voicebot for **Travianet**, built on **AudioCodes LiveHub AI Agents** with
**Gemini 3.1 Flash Live** (speech-to-speech streaming), plus a mock booking backend
(Docker) that the bot calls via REST.

```
caller ──► LiveHub (trv-de-main + sub-agents, gemini-3.1-flash-live)
                │  REST tools  (X-Api-Key, X-Conversation-Id, Accept-Language)
                ▼
          travianet-api  (Docker, Node/Express, in-memory mock data)
                │
                └─► hand-over record ──► transfer_call to Sikom service 2 / 3 / 4
```

| Folder | Content |
|---|---|
| `backend/` | Mock booking system: identification, auth token, bookings, cancellation, rebooking, documents, payment link, Sikom hand-overs. Tests with vitest. |
| `livehub/` | Agent topology, German prompts, tool definitions, provisioning script, chat runner, test suite. |
| `docker-compose.yml` | VPS deployment behind Traefik (same pattern as PPGCRM). |

## Call flow (from the flowchart)

| Agent | Role |
|---|---|
| `trv-de-main` | Welcome, asks for the reason of the call, routes. |
| `trv-de-auth` | Identification: **TIS-ID (8 digits) → postal code → travel date** → `trv_verify_customer`. |
| `trv-de-booking` | Topic (Umbuchung, Stornierung, Reiseunterlagen, Bezahlung). Verified: answers from the booking, resends documents, sends payment link. Unverified: hand-over to Sikom 2 (cancellation) or 3 (other topics). |
| `trv-de-cancel` | Cancellation fee quote → explicit confirmation → cancel, or hand-over to Sikom 2. |
| `trv-de-rebook` | Alternative dates → confirmation → rebook, or hand-over to Sikom 3. |
| `trv-de-offer` | Offer request: TIS-ID present? → check → collect wishes → hand-over to Sikom 4. |

All agents use `delegate` orchestration. In a multi-agent topology the main agent's
speech-to-speech model serves the whole call.

### Identification and token

1. `POST /api/v1/auth/verify` with `tis_id`, `postal_code`, `travel_date`.
2. On success the backend generates a **token** (random, 30 min TTL) and returns it with the customer and booking.
3. All booking actions require that token: `Authorization: Bearer <token>`.
4. **Voice channel:** the backend also binds the token to the LiveHub conversation id
   (`X-Conversation-Id: {conversationId}` on every tool). The bot therefore never
   has to repeat a 32-character token through the LLM or carry it across agent hand-overs.
   An unverified conversation has no token, and every protected tool returns `401 not_verified`.

**Retry policy, enforced by the backend:** a wrong data combination (`not_matched`) consumes one of
`MAX_AUTH_ATTEMPTS` (default 2, as in the flowchart: one retry). After that the backend answers
`next_action: continue_unverified`, and the bot continues to the topic and hands over to Sikom.
Misheard input (e.g. 7 digits) is reported as `invalid_format` with exactly what was understood.
It does not consume an attempt, but is capped at `MAX_FORMAT_ERRORS` (default 3).
The bot just follows `next_action`, so it can never loop and never skips the check.

## The customer's issues and what addresses them

| # | Issue | Cause | What we did |
|---|---|---|---|
| 1 | 10 s silence after the welcome | Speech-to-speech models wait forever when the caller is silent. Gemini's built-in VAD also sporadically "freezes", more often for non-English speech (documented LiveHub issue). In the customer's version the welcome had no question, so both sides waited. | `gemini_audio.vad_mode: "silero"` (avoids the freeze), `inactivity_reminder` after 7 s (the bot re-asks, says goodbye after the 3rd), welcome ends with a question, `establish_llm_connection: true`. |
| 2 | Welcome cut off after "Guten Tag" | With Gemini Live, the model itself speaks the static welcome. Line noise or an early "Hallo" barges in. | `welcome_message_barge_in: false` and `welcome_message_parts` (first part never interruptible). The prompt also pins the exact wording. |
| 3 | Correct 8-digit TIS-ID rejected | The LLM was asked to validate digit counts itself. Voice models hear "zwölf vierunddreißig…" or digit groups and miscount. A list of cases in the prompt cannot be matched reliably. | The LLM **never validates**. It passes what it heard; the backend normalizes spoken digits (digits, groups, German/English number words, "doppel fünf"), checks the length and matches against real data. It reports what it understood ("7 digits: 1234567") so the bot can ask precisely. |
| 4 | German/English mix, English welcome | English-dominant model defaults, English prompt parts, no language rule for the welcome. | All prompts are in German with a strict language block (no English filler words, answers in German even to English callers). The welcome text is fixed in German. Tested: an English caller gets a German answer. |
| 5 | Invalid data: first ignored, later endless loop | The flow was left to the LLM's judgement, which differs between calls. | Deterministic policy in the backend (`next_action`), see above. |
| 6 | "Alles klar, dann starten wir" | The model improvises a reply to the platform's start or welcome instruction. | Static welcome (not dynamic), the exact text pinned in the prompt, and an explicit ban on such filler phrases and on announcing internal hand-overs. |

Two Gemini Live behaviours found while testing, and handled:

- **`end_call` and `transfer_call` are called without speaking first.** The caller would be hung up on or transferred in silence.
  - Calls end via `end_call_detection`: the bot says "… Auf Wiederhören." and LiveHub hangs up after playing it. The `end_call` tool is not given to the agents.
  - Transfers are announced in their own turn ("Ich verbinde Sie mit einem Kollegen. Ist das in Ordnung?"). The hand-over and `transfer_call` run only after the caller agrees.
- **With a "default number" on `transfer_call`, the model cannot choose the destination.** The booking agent (service 2 or 3) therefore passes `phone` itself, restricted by `valid_numbers`.

## Backend

```bash
cd backend
npm ci
npm test            # 65 tests: digit normalisation, auth/token, retry policy, bookings, hand-overs
npm run dev         # http://localhost:8080 (no API key in dev)
```

Configuration (environment):

| Variable | Default | |
|---|---|---|
| `API_KEY` | – | Shared secret the LiveHub tools send as `X-Api-Key`. **Set it in production.** |
| `ADMIN_KEY` | – | Enables `/api/admin/*` and `GET /api/v1/handovers` (`X-Admin-Key`). |
| `TOKEN_TTL_MINUTES` | 30 | Token lifetime. |
| `MAX_AUTH_ATTEMPTS` | 2 | Wrong-data attempts before `continue_unverified`. |
| `MAX_FORMAT_ERRORS` | 3 | Misheard inputs before `continue_unverified`. |
| `DEFAULT_LANGUAGE` | de | Language of labels when no `Accept-Language` is sent. |

### API

All `/api/v1` routes need `X-Api-Key` (when `API_KEY` is set). 🔒 = needs the token (Bearer or a verified `X-Conversation-Id`).

| Method & path | |
|---|---|
| `GET /api/health` | Health check (public). |
| `POST /api/v1/auth/verify` | `{tis_id, postal_code, travel_date}` → `verified` + token, or `invalid_format` / `not_matched` / `attempts_exhausted` with `next_action`. |
| `GET /api/v1/auth/session` 🔒 | Token info. |
| `POST /api/v1/auth/logout` 🔒 | Revoke the token. |
| `POST /api/v1/tis/check` | `{tis_id}` → `found` / `not_found` / `invalid_format` (offer branch, no personal data). |
| `GET /api/v1/bookings` 🔒 | All bookings of the verified customer. |
| `GET /api/v1/booking` 🔒 | The verified booking. Also `/api/v1/bookings/{bookingNumber}` for any booking of the customer, with the same sub-routes. |
| `GET /api/v1/booking/cancellation-quote` 🔒 | Fee by days before departure (25 % > 30 days … 90 % < 7 days). |
| `POST /api/v1/booking/cancel` 🔒 | `{confirmed: true, reason?}`. |
| `POST /api/v1/booking/rebooking-options` 🔒 | `{preferred_date?}` → up to 3 options (possible ≥ 31 days before departure). |
| `POST /api/v1/booking/rebook` 🔒 | `{option_id, confirmed: true}`. |
| `POST /api/v1/booking/documents/resend` 🔒 | Sends the documents, or says from when they are available. |
| `POST /api/v1/booking/payment-link` 🔒 | Payment link for the outstanding balance. |
| `POST /api/v1/handovers` | `{service: 2/3/4, topic, summary, tis_id?}`. Stores the data for Sikom ("Datenübergabe an Service von travianet"). |
| `GET /api/v1/handovers` | List of hand-overs (admin). |
| `GET/POST /api/admin/bookings`, `PATCH/DELETE /api/admin/bookings/{number}` | Manage bookings (admin page). |
| `GET/POST /api/admin/customers`, `PUT/DELETE /api/admin/customers/{tisId}` | Manage customers (admin page). |
| `GET /api/admin/handovers` · `GET /api/admin/outbox` · `POST /api/admin/reset` · `GET /api/admin/state` | Hand-overs, simulated emails, reset demo data, raw state (admin). |
| `GET /pay/{id}` · `POST /pay/{id}` | Mock payment page behind the payment link (public, random id). |

Every response carries machine codes **and** labels and spoken dates in the requested language
(`Accept-Language: de-DE` / `en`), e.g. `departure_date_spoken: "Donnerstag, 15. Juli 2027"`.

### Demo data

| TIS-ID | PLZ | Travel date | Customer / trip |
|---|---|---|---|
| 12345678 | 10117 | 15.07.2027 | Max Mustermann, Ibiza (deposit paid, documents pending) |
| 10293847 | 80331 | 14.11.2026 | Thomas Müller, Mallorca (paid, documents available) |
| 10293847 | 80331 | 20.05.2027 | Thomas Müller, Kreta (second booking) |
| 20481516 | 50667 | 24.10.2026 | Anna Schmidt, Antalya (documents sent, too close to rebook) |
| 31415926 | 20095 | 28.12.2026 | Petra Wagner, Dubai (balance overdue) |
| 27182818 | 10115 | 06.02.2027 | Mehmet Yılmaz, Teneriffa |
| 16180339 | 60311 | 12.03.2027 | Julia Becker, Malediven (already cancelled) |
| 55501234 | 70173 | 10.10.2026 | Lukas Hoffmann, Rom (departs in a few days → 90 % fee) |
| 87654321 | 01067 | 01.06.2027 | Sabine Koch, Hurtigruten |
| 44556677 | 1010 | 09.01.2027 | Stefan Fischer, Gran Canaria (Austria) |
| 99887766 | 8001 | 02.04.2027 | Laura Weber, Kapstadt (Switzerland, CHF) |
| 64209753 | 04109 | 01.08.2026 | Maria Schulz, Rhodos (trip completed) |

Data lives in memory: restarting the container or calling `POST /api/admin/reset` restores it.

### Booking admin page

`https://<API_HOST>/admin` is a small web interface for the demo data. It has three tabs:

- **Buchungen:** search and filter bookings, create, edit (status, dates, payment, documents, travellers) or delete them.
- **Kunden:** create, edit or delete customers (TIS-ID, postal code, contact).
- **Übergaben:** the hand-overs the voicebot recorded for Sikom.
- **E-Mails:** the simulated outbox (see below).

"Demo-Daten zurücksetzen" restores the seed data. Changes take effect for the voicebot immediately; a booking you create here can be verified on the phone straight away.

### Simulated emails and the payment link

The backend never sends real emails. Every email the bot triggers is written to an outbox instead, and shown on the "E-Mails" tab:

| Trigger | Email |
|---|---|
| `trv_send_payment_link` | Payment link for the outstanding balance |
| `trv_resend_documents` (documents available) | Travel documents (no files attached) |
| `trv_cancel_booking` | Cancellation confirmation with fee and refund |
| `trv_rebook_booking` | Rebooking confirmation with the new dates and price |

Emails are written in the caller's language (`Accept-Language`). The payment link points to a mock payment page on the backend (`/pay/<id>`, random id). "Jetzt bezahlen" settles the balance, so the booking shows "Bezahlt" and the bot then reports nothing left to pay. No real money is involved; the page says so. "Demo-Daten zurücksetzen" also clears the outbox and payment links.

The page itself is public, but every action goes through `/api/admin/*` with the `X-Admin-Key` header. The page asks for the key once and keeps it in the browser's local storage until you log out. Without `ADMIN_KEY` the admin API is disabled in production (403).

## Deploy to the VPS

The setup mirrors PPGCRM: GitHub Actions builds `dabikkel/travianet-api` on pushes to `main`
(needs the repo secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`). Traefik runs with the external
`traefik-public` network and a `letsencrypt` resolver.

```bash
# on the VPS
git clone https://github.com/egoppel/travianet-demo.git && cd travianet-demo
cp .env.example .env      # set API_HOST, API_KEY (same value as used for provisioning), ADMIN_KEY
docker compose pull && docker compose up -d       # or: docker compose up -d --build
curl https://$API_HOST/api/health
```

To run locally without Traefik: `docker compose -f docker-compose.local.yml up --build`.

## LiveHub

```bash
# needs LIVEHUB_CLIENT_ID / LIVEHUB_CLIENT_SECRET, API_KEY, TRAVIANET_API_URL, SIKOM_SERVICE_2/3/4 (see .env.example)
node livehub/provision.mjs --lang de            # create/update the 6 agents, 10 tools and the test suite
node livehub/provision.mjs --lang de --dry-run  # print the manifest
node livehub/chat.mjs --scenario cancel         # scripted text chat (scenarios: livehub/locales/de/chat-scenarios.json)
node --test livehub/test/manifest.test.mjs      # offline consistency checks (also run in CI)
```

`livehub/` is the source of truth. `provision.mjs` replaces the agents and tools in LiveHub
completely, so make changes in the files and re-run it rather than editing in the LiveHub UI.

Still to do in the LiveHub UI after provisioning:
1. Connect `trv-de-main` to a bot connection and phone number, with **voice streaming enabled** (needed for speech-to-speech).
2. Add a **Transfer** routing rule for that bot (needed for `transfer_call`).
3. Set the real Sikom targets in `SIKOM_SERVICE_2/3/4` and re-run provisioning. Placeholders `+49000000000x` are used until then.

The test suite `trv-de-regression` (LiveHub → Test suites) has 9 cases: welcome, number words,
cancellation, 7-digit input, no loop on wrong data, offer request, rebooking, English caller, and no data
without identification. Most need the backend to be reachable at `TRAVIANET_API_URL`.

## Adding a language

Nothing in the backend or the tools is language specific. To add English:

1. Copy `livehub/locales/de` to `livehub/locales/en`.
2. In `locale.json`, set `language`, `accept_language` (`en-GB`), `agent_prefix` (`trv-en`), the welcome parts, the reminder texts, `end_call_keywords` (e.g. `"Goodbye"`) and a voice.
3. Translate the prompts in `prompts/` (keep the `[[...]]` markers and `{variables}`), plus `test-suite.json` and `chat-scenarios.json`.
4. If needed, add labels for the new language in `backend/src/lib/i18n.ts`.
5. Run `node livehub/provision.mjs --lang en`. This creates `trv-en-main` and its sub-agents next to the German bot, sharing the same tools. Route a phone number or bot connection to it, or add a language-routing front agent.
