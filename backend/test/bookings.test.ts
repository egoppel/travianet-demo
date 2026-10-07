import { describe, expect, it } from "vitest";
import { MAX, setup } from "./helpers.js";

async function verified(data: object = MAX, overrides = {}) {
  const ctx = setup(overrides);
  const res = await ctx.api().post("/api/v1/auth/verify").set("X-Conversation-Id", "conv").send(data);
  expect(res.body.result).toBe("verified");
  const as = (r: ReturnType<ReturnType<typeof ctx.api>["get"]>) => r.set("X-Conversation-Id", "conv");
  return { ...ctx, as };
}

const MUELLER_MALLORCA = { tis_id: "10293847", postal_code: "80331", travel_date: "14.11.2026" };
const HOFFMANN_ROM = { tis_id: "55501234", postal_code: "70173", travel_date: "10.10.2026" };
const BECKER_CANCELLED = { tis_id: "16180339", postal_code: "60311", travel_date: "12.03.2027" };
const SCHMIDT_ANTALYA = { tis_id: "20481516", postal_code: "50667", travel_date: "24.10.2026" };

describe("booking details", () => {
  it("returns labels in the requested language", async () => {
    const { api, as } = await verified();
    const de = await as(api().get("/api/v1/booking"));
    expect(de.body.booking.payment.status_label).toBe("Anzahlung bezahlt, Restzahlung offen");
    expect(de.body.booking.payment.balance_due).toBe(2784);
    const en = await as(api().get("/api/v1/booking").set("Accept-Language", "en-GB,en;q=0.9"));
    expect(en.body.booking.payment.status_label).toBe("deposit paid, balance outstanding");
    expect(en.body.booking.departure_date_spoken).toMatch(/^Thursday,? 15 July 2027$/);
  });

  it("lists all bookings of the customer", async () => {
    const { api, as } = await verified(MUELLER_MALLORCA);
    const res = await as(api().get("/api/v1/bookings"));
    expect(res.body.bookings.map((b: { booking_number: string }) => b.booking_number)).toEqual(["4711002", "4711003"]);
  });
});

describe("cancellation", () => {
  it("quotes the fee by days before departure", async () => {
    const { api, as } = await verified(MUELLER_MALLORCA);
    const res = await as(api().get("/api/v1/booking/cancellation-quote"));
    // 38 days before departure -> 25 %
    expect(res.body).toMatchObject({ days_before_departure: 38, cancellation_percentage: 25, cancellation_fee: 473, refund_amount: 1417 });
  });

  it("charges 90 % shortly before departure", async () => {
    const { api, as } = await verified(HOFFMANN_ROM);
    const res = await as(api().get("/api/v1/booking/cancellation-quote"));
    expect(res.body).toMatchObject({ days_before_departure: 3, cancellation_percentage: 90, cancellation_fee: 1206 });
  });

  it("requires explicit confirmation and then cancels", async () => {
    const { api, as, store } = await verified(MUELLER_MALLORCA);
    await as(api().post("/api/v1/booking/cancel")).send({}).expect(400);
    const res = await as(api().post("/api/v1/booking/cancel")).send({ confirmed: true, reason: "Krankheit" });
    expect(res.body).toMatchObject({ result: "cancelled", cancellation_fee: 473, refund_amount: 1417, confirmation_sent_to: "t***r@example.com" });
    expect(store.bookings.get("4711002")!.status).toBe("cancelled");
    const again = await as(api().post("/api/v1/booking/cancel")).send({ confirmed: true });
    expect(again.body.result).toBe("not_cancellable");
  });

  it("does not cancel an already cancelled booking", async () => {
    const { api, as } = await verified(BECKER_CANCELLED);
    const res = await as(api().get("/api/v1/booking/cancellation-quote"));
    expect(res.body).toEqual({ result: "not_cancellable", status: "cancelled" });
  });
});

describe("rebooking", () => {
  it("offers alternatives around a preferred date and rebooks", async () => {
    const { api, as, store } = await verified();
    const opts = await as(api().post("/api/v1/booking/rebooking-options")).send({ preferred_date: "1. August" });
    expect(opts.body.result).toBe("options");
    expect(opts.body.options[0]).toMatchObject({ option_id: "U1", departure_date: "2027-08-01", return_date: "2027-08-15", change_fee: 100 });

    await as(api().post("/api/v1/booking/rebook")).send({ option_id: "U1" }).expect(400);
    const done = await as(api().post("/api/v1/booking/rebook")).send({ option_id: "u1", confirmed: true });
    expect(done.body).toMatchObject({ result: "rebooked", new_departure_date: "2027-08-01" });
    expect(store.bookings.get("4711001")!.departureDate).toBe("2027-08-01");
  });

  it("rejects unknown options", async () => {
    const { api, as } = await verified();
    const res = await as(api().post("/api/v1/booking/rebook")).send({ option_id: "U9", confirmed: true });
    expect(res.status).toBe(409);
  });

  it("is not possible shortly before departure", async () => {
    const { api, as } = await verified(SCHMIDT_ANTALYA);
    const res = await as(api().post("/api/v1/booking/rebooking-options")).send({});
    expect(res.body).toMatchObject({ result: "not_rebookable", reason: "too_close_to_departure", days_before_departure: 17 });
  });
});

describe("documents & payment", () => {
  it("resends available documents", async () => {
    const { api, as } = await verified(MUELLER_MALLORCA);
    const res = await as(api().post("/api/v1/booking/documents/resend"));
    expect(res.body).toEqual({ result: "sent", sent_to: "t***r@example.com" });
  });

  it("says when documents are not available yet", async () => {
    const { api, as } = await verified();
    const res = await as(api().post("/api/v1/booking/documents/resend"));
    expect(res.body).toMatchObject({ result: "not_yet_available", available_from: "2027-07-01" });
  });

  it("sends a payment link for the outstanding balance", async () => {
    const { api, as } = await verified();
    const res = await as(api().post("/api/v1/booking/payment-link"));
    expect(res.body).toMatchObject({ result: "sent", amount: 2784, currency: "EUR" });
  });
});

describe("handovers to Sikom", () => {
  it("records a verified handover with the booking context", async () => {
    const { api, as } = await verified();
    const res = await as(api().post("/api/v1/handovers")).send({ service: 2, topic: "Stornierung", summary: "Kunde möchte stornieren" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ handover_id: "HO-0001", service: 2, verified: true });
    const list = await api().get("/api/v1/handovers");
    expect(list.body.handovers[0]).toMatchObject({ tisId: "12345678", bookingNumber: "4711001", conversationId: "conv" });
  });

  it("records an unverified handover (offer request without TIS-ID)", async () => {
    const { api, store } = setup();
    const res = await api().post("/api/v1/handovers").set("X-Caller", "+4917612345").send({ service: 4, topic: "Angebotsanfrage", summary: "Familienurlaub Sommer" });
    expect(res.body).toMatchObject({ verified: false, service: 4 });
    expect(store.handovers[0].callerPhone).toBe("+4917612345");
  });

  it("validates the service number", async () => {
    const { api } = setup();
    await api().post("/api/v1/handovers").send({ service: 7, topic: "x" }).expect(400);
  });
});

describe("TIS-ID check (offer branch)", () => {
  it("finds known TIS-IDs without returning personal data", async () => {
    const { api } = setup();
    expect((await api().post("/api/v1/tis/check").send({ tis_id: "1234 5678" })).body).toEqual({ result: "found", tis_id: "12345678", problem: null });
    expect((await api().post("/api/v1/tis/check").send({ tis_id: "11111111" })).body.result).toBe("not_found");
    expect((await api().post("/api/v1/tis/check").send({ tis_id: "111" })).body.result).toBe("invalid_format");
  });
});

describe("admin", () => {
  it("resets the demo data", async () => {
    const { api, as, store } = await verified(MUELLER_MALLORCA);
    await as(api().post("/api/v1/booking/cancel")).send({ confirmed: true });
    await api().post("/api/admin/reset").expect(200);
    expect(store.bookings.get("4711002")!.status).toBe("confirmed");
    expect(store.sessions.size).toBe(0);
  });

  it("is disabled in production without ADMIN_KEY", async () => {
    const { api } = setup({ apiKey: "k" });
    await api().post("/api/admin/reset").expect(403);
  });

  it("requires the admin key when configured", async () => {
    const { api } = setup({ apiKey: "k", adminKey: "adm" });
    await api().post("/api/admin/reset").expect(401);
    await api().post("/api/admin/reset").set("X-Admin-Key", "adm").expect(200);
  });
});
