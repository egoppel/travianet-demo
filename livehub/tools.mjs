/**
 * Custom REST tools that call the Travianet backend. Tool names and descriptions
 * are language neutral (English); the spoken language is defined by the prompts.
 *
 * Every tool sends:
 *   X-Api-Key          shared secret (tool variable of type "secret")
 *   X-Conversation-Id  LiveHub conversation id -> the backend binds the auth token
 *                      to it, so the token never has to pass through the LLM
 *   Accept-Language    {accept_language} agent variable -> labels in the call language
 */

function headers(extra = "") {
  return [
    "X-Api-Key: {api_key}",
    "X-Conversation-Id: {conversationId}",
    "Accept-Language: {accept_language}",
    extra,
  ].filter(Boolean).join("\n");
}

function rest(baseUrl, apiKey, { path, extraHeaders, ...def }) {
  return {
    type: "rest",
    method: "POST",
    timeout: 10,
    // The model must wait for these results before it continues talking.
    realtime_async_mode: false,
    wait_response: true,
    tool_response: "keep",
    headers: headers(extraHeaders),
    variables: [{ name: "api_key", type: "secret", value: apiKey }],
    advanced_config: { explicit_errors: true },
    params: [],
    ...def,
    url: `${baseUrl.replace(/\/$/, "")}${path}`,
  };
}

export function buildTools({ baseUrl, apiKey }) {
  const t = (def) => rest(baseUrl, apiKey, def);
  return [
    t({
      name: "trv_verify_customer",
      description:
        "Identify and authorize a caller with an existing booking. Call it once you have the TIS-ID, the postal code and the travel (departure) date. " +
        "Pass the values exactly as the caller said them; the system normalizes spoken digits and validates the format. " +
        "Follow the returned `result` and `next_action` fields.",
      path: "/api/v1/auth/verify",
      params: [
        { name: "tis_id", type: "str", required: true, description: "The 8-digit TIS-ID exactly as heard, digits or spoken number words. Do not shorten, pad or validate it yourself." },
        { name: "postal_code", type: "str", required: true, description: "The caller's postal code exactly as heard (Germany 5 digits, Austria/Switzerland 4)." },
        { name: "travel_date", type: "str", required: true, description: "Departure date, preferably YYYY-MM-DD. If the caller gave no year, pass day and month as said, e.g. '14. November'." },
      ],
    }),
    t({
      name: "trv_check_tis_id",
      description: "Check whether a TIS-ID belongs to an existing customer (offer requests). Returns found / not_found / invalid_format, no personal data.",
      path: "/api/v1/tis/check",
      params: [{ name: "tis_id", type: "str", required: true, description: "The TIS-ID exactly as heard." }],
    }),
    t({
      name: "trv_get_booking",
      description: "Get the full details of the verified caller's booking: status, travel dates, hotel, flights, travellers, payment and travel documents.",
      path: "/api/v1/booking",
      method: "GET",
    }),
    t({
      name: "trv_resend_documents",
      description: "Send the travel documents of the verified caller's booking to the email address on file.",
      path: "/api/v1/booking/documents/resend",
    }),
    t({
      name: "trv_send_payment_link",
      description: "Email a payment link for the outstanding balance of the verified caller's booking. Only after the caller agreed.",
      path: "/api/v1/booking/payment-link",
    }),
    t({
      name: "trv_get_cancellation_quote",
      description: "Calculate the cancellation fee and refund for the verified caller's booking. Does not cancel anything.",
      path: "/api/v1/booking/cancellation-quote",
      method: "GET",
    }),
    t({
      name: "trv_cancel_booking",
      description: "Cancel the verified caller's booking. Only call after you told the caller the fee and they explicitly confirmed.",
      path: "/api/v1/booking/cancel",
      params: [
        { name: "confirmed", type: "bool", required: true, description: "Must be true: the caller explicitly confirmed the cancellation and its costs." },
        { name: "reason", type: "str", required: false, description: "Reason for the cancellation, if the caller gave one." },
      ],
    }),
    t({
      name: "trv_get_rebooking_options",
      description: "Get up to three alternative travel dates for the verified caller's booking, with price difference and change fee.",
      path: "/api/v1/booking/rebooking-options",
      params: [
        { name: "preferred_date", type: "str", required: false, description: "The caller's preferred new departure date, YYYY-MM-DD if possible." },
      ],
    }),
    t({
      name: "trv_rebook_booking",
      description: "Rebook the verified caller's booking to one of the options from trv_get_rebooking_options. Only after the caller explicitly confirmed date and costs.",
      path: "/api/v1/booking/rebook",
      params: [
        { name: "option_id", type: "str", required: true, description: "option_id of the chosen option, e.g. 'U1'." },
        { name: "confirmed", type: "bool", required: true, description: "Must be true: the caller explicitly confirmed." },
      ],
    }),
    t({
      name: "trv_create_handover",
      description:
        "Hand the case over to a Sikom service team (2 = cancellation, 3 = all other booking topics, 4 = offer requests). " +
        "Stores the collected data for the agent who takes the call. Call it right before transferring the call.",
      path: "/api/v1/handovers",
      extraHeaders: "X-Caller: {caller}",
      params: [
        { name: "service", type: "int", required: true, description: "Sikom service number: 2, 3 or 4." },
        { name: "topic", type: "str", required: true, description: "Topic in a few words, e.g. 'Stornierung'." },
        { name: "summary", type: "str", required: true, description: "One or two sentences: what the caller wants and what is already clarified." },
        { name: "tis_id", type: "str", required: false, description: "TIS-ID the caller mentioned, if any." },
      ],
    }),
  ];
}
