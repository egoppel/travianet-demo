import { describe, expect, it } from "vitest";
import { MAX, setup } from "./helpers.js";

/** Intl puts a non-breaking space before the currency sign. */
const plain = (s: string) => s.replace(/\u00a0/g, " ");

async function verified(data: object = MAX) {
  const ctx = setup();
  await ctx.api().post("/api/v1/auth/verify").set("X-Conversation-Id", "conv").send(data).expect(200);
  return ctx;
}
const MUELLER_MALLORCA = { tis_id: "10293847", postal_code: "80331", travel_date: "14.11.2026" };

describe("simulated email outbox", () => {
  it("a payment link creates an email with a link to the mock payment page", async () => {
    const { api, store } = await verified();
    await api().post("/api/v1/booking/payment-link").set("X-Conversation-Id", "conv")
      .set("X-Forwarded-Proto", "https").set("X-Forwarded-Host", "travianet.example").expect(200);
    expect(store.outbox).toHaveLength(1);
    const mail = store.outbox[0];
    expect(mail).toMatchObject({ kind: "payment_link", to: "max.mustermann@example.com", bookingNumber: "4711001", language: "de" });
    expect(mail.subject).toBe("Ihr Zahlungslink für Vorgang 4711001");
    expect(mail.body).toContain("Sehr geehrter Herr Mustermann");
    expect(plain(mail.body)).toContain("2.784,00 €");
    expect(mail.link).toMatch(/^https:\/\/travianet\.example\/pay\/[A-Za-z0-9_-]{16}$/);
    expect(mail.body).toContain(mail.link);
  });

  it("paying on the mock page settles the balance", async () => {
    const { api, store } = await verified();
    await api().post("/api/v1/booking/payment-link").set("X-Conversation-Id", "conv").expect(200);
    const path = new URL(store.outbox[0].link!).pathname;

    const page = await api().get(path).expect(200);
    expect(page.text).toContain("Jetzt bezahlen");
    expect(plain(page.text)).toContain("2.784,00 €");

    await api().post(path).expect(303);
    const b = store.bookings.get("4711001")!;
    expect(b).toMatchObject({ amountPaid: 3480, paymentStatus: "paid", balanceDueDate: null });
    expect((await api().get(path)).text).toContain("Vielen Dank");

    // paying twice changes nothing
    await api().post(path).expect(303);
    expect(store.bookings.get("4711001")!.amountPaid).toBe(3480);

    // and the bot now sees nothing to pay
    const again = await api().post("/api/v1/booking/payment-link").set("X-Conversation-Id", "conv");
    expect(again.body.result).toBe("nothing_to_pay");
  });

  it("unknown payment links show an error page", async () => {
    const { api } = setup();
    const res = await api().get("/pay/doesnotexist").expect(404);
    expect(res.text).toContain("Link ungültig");
    await api().post("/pay/doesnotexist").expect(404);
  });

  it("cancellation, rebooking and documents produce emails too", async () => {
    const { api, store } = await verified(MUELLER_MALLORCA);
    await api().post("/api/v1/booking/documents/resend").set("X-Conversation-Id", "conv").expect(200);
    await api().post("/api/v1/booking/cancel").set("X-Conversation-Id", "conv").send({ confirmed: true }).expect(200);
    expect(store.outbox.map((m) => m.kind)).toEqual(["documents", "cancellation_confirmation"]);
    expect(plain(store.outbox[1].body)).toContain("Stornokosten: 473,00 €");
    expect(plain(store.outbox[1].body)).toContain("Wir erstatten Ihnen 1.417,00 €.");

    const max = await verified();
    await max.api().post("/api/v1/booking/rebooking-options").set("X-Conversation-Id", "conv").send({ preferred_date: "2027-08-01" });
    await max.api().post("/api/v1/booking/rebook").set("X-Conversation-Id", "conv").send({ option_id: "U1", confirmed: true }).expect(200);
    expect(max.store.outbox[0]).toMatchObject({ kind: "rebooking_confirmation", subject: "Umbuchungsbestätigung für Vorgang 4711001" });
  });

  it("documents that are not available yet send no email", async () => {
    const { api, store } = await verified();
    await api().post("/api/v1/booking/documents/resend").set("X-Conversation-Id", "conv").expect(200);
    expect(store.outbox).toHaveLength(0);
  });

  it("uses the caller's language", async () => {
    const { api, store } = await verified();
    await api().post("/api/v1/booking/payment-link").set("X-Conversation-Id", "conv").set("Accept-Language", "en-GB").expect(200);
    expect(store.outbox[0].subject).toBe("Your payment link for booking 4711001");
    expect(store.outbox[0].body).toContain("Dear Mr Mustermann");
  });

  it("the admin outbox lists messages newest first with payment state, reset clears it", async () => {
    const { api, store } = await verified();
    await api().post("/api/v1/booking/payment-link").set("X-Conversation-Id", "conv").expect(200);
    await api().post(new URL(store.outbox[0].link!).pathname).expect(303);
    const res = await api().get("/api/admin/outbox").expect(200);
    expect(res.body.messages[0]).toMatchObject({ kind: "payment_link" });
    expect(res.body.messages[0].paidAt).toBeTruthy();
    await api().post("/api/admin/reset").expect(200);
    expect(store.outbox).toHaveLength(0);
    expect(store.paymentLinks.size).toBe(0);
  });
});
