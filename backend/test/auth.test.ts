import { describe, expect, it } from "vitest";
import { MAX, NOW, setup } from "./helpers.js";

describe("POST /api/v1/auth/verify", () => {
  it("verifies with TIS-ID, postal code and travel date and returns a token", async () => {
    const { api } = setup();
    const res = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c1").send(MAX);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe("verified");
    expect(res.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(res.body.next_action).toBe("ask_topic");
    expect(res.body.customer).toMatchObject({ salutation: "Herr", last_name: "Mustermann" });
    expect(res.body.booking.booking_number).toBe("4711001");
    expect(new Date(res.body.expires_at).getTime() - NOW.getTime()).toBe(30 * 60 * 1000);
  });

  it("accepts spoken forms exactly as a voice model passes them", async () => {
    const { api } = setup();
    const res = await api().post("/api/v1/auth/verify").send({
      tis_id: "zehn neunundzwanzig achtunddreißig siebenundvierzig",
      postal_code: "acht null drei drei eins",
      travel_date: "vierzehnter November",
    });
    expect(res.body.result).toBe("verified");
    expect(res.body.booking.destination).toBe("Mallorca, Spanien");
    expect(res.body.other_bookings).toHaveLength(1);
  });

  it("accepts numeric JSON values", async () => {
    const { api } = setup();
    const res = await api().post("/api/v1/auth/verify").send({ tis_id: 12345678, postal_code: 10117, travel_date: "15.07.2027" });
    expect(res.body.result).toBe("verified");
  });

  it("uses the travel date to pick the right booking of a customer", async () => {
    const { api } = setup();
    const res = await api().post("/api/v1/auth/verify").send({ tis_id: "10293847", postal_code: "80331", travel_date: "20.05.2027" });
    expect(res.body.booking.destination).toBe("Kreta, Griechenland");
  });

  it("reports a wrong-length TIS-ID without consuming an auth attempt", async () => {
    const { api } = setup();
    const res = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c2").send({ ...MAX, tis_id: "1234567" });
    expect(res.body).toMatchObject({
      result: "invalid_format",
      problems: [{ field: "tis_id", code: "wrong_length", digits_received: 7, understood: "1234567" }],
      attempts_used: 0,
      next_action: "retry",
    });
  });

  it("flowchart: wrong data -> one retry -> continue unverified (never an endless loop)", async () => {
    const { api } = setup();
    const wrong = { ...MAX, postal_code: "99999" };
    const first = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c3").send(wrong);
    expect(first.body).toMatchObject({ result: "not_matched", attempts_used: 1, attempts_remaining: 1, next_action: "retry" });
    // no hint which field was wrong
    expect(first.body.problems).toEqual([]);

    const second = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c3").send(wrong);
    expect(second.body).toMatchObject({ result: "not_matched", attempts_remaining: 0, next_action: "continue_unverified" });

    // even correct data is no longer accepted in this conversation
    const third = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c3").send(MAX);
    expect(third.body).toMatchObject({ result: "attempts_exhausted", next_action: "continue_unverified" });
  });

  it("caps repeated format errors too", async () => {
    const { api } = setup({ maxFormatErrors: 2 });
    const bad = { ...MAX, tis_id: "123" };
    const a = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c4").send(bad);
    expect(a.body.next_action).toBe("retry");
    const b = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c4").send(bad);
    expect(b.body.next_action).toBe("continue_unverified");
  });

  it("attempts are tracked per conversation", async () => {
    const { api } = setup();
    const wrong = { ...MAX, travel_date: "01.01.2027" };
    await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c5").send(wrong);
    await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c5").send(wrong);
    const other = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c6").send(MAX);
    expect(other.body.result).toBe("verified");
  });

  it("ignores an unresolved LiveHub placeholder as conversation id", async () => {
    const { api, store } = setup();
    await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "{conversationId}").send({ ...MAX, postal_code: "99999" });
    expect(store.conversations.size).toBe(0);
  });

  it("reports every problem at once", async () => {
    const { api } = setup();
    const res = await api().post("/api/v1/auth/verify").send({ tis_id: "12", travel_date: "irgendwann" });
    expect(res.body.problems.map((p: { field: string }) => p.field)).toEqual(["tis_id", "postal_code", "travel_date"]);
  });
});

describe("token usage", () => {
  it("protected routes need a token", async () => {
    const { api } = setup();
    const res = await api().get("/api/v1/booking");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "not_verified", next_action: "verify_identity" });
  });

  it("accepts the bearer token", async () => {
    const { api } = setup();
    const { body } = await api().post("/api/v1/auth/verify").send(MAX);
    const res = await api().get("/api/v1/booking").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.booking_number).toBe("4711001");
  });

  it("voice channel: the token is bound to the conversation id", async () => {
    const { api } = setup();
    await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "call-42").send(MAX);
    const ok = await api().get("/api/v1/booking").set("X-Conversation-Id", "call-42");
    expect(ok.status).toBe(200);
    const other = await api().get("/api/v1/booking").set("X-Conversation-Id", "call-43");
    expect(other.status).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const { api, store } = setup();
    const { body } = await api().post("/api/v1/auth/verify").send(MAX);
    store.sessions.get(body.token)!.expiresAt = new Date(NOW.getTime() - 1);
    const res = await api().get("/api/v1/booking").set("Authorization", `Bearer ${body.token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("token_expired");
  });

  it("logout revokes the token", async () => {
    const { api } = setup();
    const { body } = await api().post("/api/v1/auth/verify").set("X-Conversation-Id", "c7").send(MAX);
    await api().post("/api/v1/auth/logout").set("Authorization", `Bearer ${body.token}`).expect(200);
    await api().get("/api/v1/booking").set("Authorization", `Bearer ${body.token}`).expect(401);
    await api().get("/api/v1/booking").set("X-Conversation-Id", "c7").expect(401);
  });

  it("a token only grants access to the verified customer's bookings", async () => {
    const { api } = setup();
    const { body } = await api().post("/api/v1/auth/verify").send(MAX);
    await api().get("/api/v1/bookings/4711002").set("Authorization", `Bearer ${body.token}`).expect(404);
  });
});

describe("API key", () => {
  it("is enforced when API_KEY is set", async () => {
    const { api } = setup({ apiKey: "s3cret" });
    await api().post("/api/v1/auth/verify").send(MAX).expect(401);
    await api().post("/api/v1/auth/verify").set("X-Api-Key", "wrong").send(MAX).expect(401);
    const res = await api().post("/api/v1/auth/verify").set("X-Api-Key", "s3cret").send(MAX);
    expect(res.body.result).toBe("verified");
  });

  it("health stays public", async () => {
    const { api } = setup({ apiKey: "s3cret" });
    await api().get("/api/health").expect(200);
  });
});
