/**
 * Language-independent definition of the Travianet voicebot: which agents exist,
 * which tools each one may use and which sub-agents it can hand over to.
 * Prompts and spoken texts live in locales/<lang>/.
 *
 *   main ──► auth ──► booking ──► cancel
 *     │                  ▲  └───► rebook
 *     └──► offer         └──────────┘
 */

export const MODEL = "gemini-3.1-flash-live";

export const AGENTS = {
  main: {
    tools: ["send_message", "transfer_call"],
    subAgents: ["auth", "offer"],
    transferDefault: "sikom_service_3",
  },
  auth: {
    tools: ["trv_verify_customer", "send_message"],
    subAgents: ["booking"],
  },
  booking: {
    tools: [
      "trv_get_booking", "trv_resend_documents", "trv_send_payment_link", "trv_create_handover",
      "send_message", "transfer_call",
    ],
    subAgents: ["cancel", "rebook"],
    // transfers to service 2 or 3: the model passes `phone`, restricted by valid_numbers
    transferDefault: null,
  },
  cancel: {
    tools: ["trv_get_cancellation_quote", "trv_cancel_booking", "trv_create_handover", "send_message", "transfer_call"],
    subAgents: ["booking"],
    transferDefault: "sikom_service_2",
  },
  rebook: {
    tools: ["trv_get_rebooking_options", "trv_rebook_booking", "trv_create_handover", "send_message", "transfer_call"],
    subAgents: ["booking"],
    transferDefault: "sikom_service_3",
  },
  offer: {
    tools: ["trv_check_tis_id", "trv_create_handover", "transfer_call"],
    subAgents: [],
    transferDefault: "sikom_service_4",
  },
};

/** Builtin LiveHub tools (everything else is a custom REST tool defined in tools.mjs). */
export const BUILTIN_TOOLS = new Set(["send_message", "pass_question", "transfer_call"]);
