import { describe, expect, it } from "vitest";
import { setup } from "./helpers.js";

const NEW_BOOKING = {
  tisId: "12345678",
  tourOperator: "TUI",
  destination: "Sizilien, Italien",
  hotel: "Hotel Baia Taormina",
  departureDate: "2027-09-10",
  returnDate: "2027-09-17",
  travellers: [{ firstName: "Max", lastName: "Mustermann" }],
  priceTotal: 1500,
  documentsAvailableFrom: "2027-08-27",
};

const admin = () => setup({ apiKey: "k", adminKey: "adm" });

describe("admin web interface", () => {
  it("serves the page at /admin", async () => {
    const { api } = admin();
    const res = await api().get("/admin").expect(200);
    expect(res.type).toBe("text/html");
    expect(res.text).toContain("Travianet · Buchungsverwaltung");
  });

  it("requires the admin key for the API", async () => {
    const { api } = admin();
    await api().get("/api/admin/bookings").expect(401);
    await api().get("/api/admin/bookings").set("X-Admin-Key", "adm").expect(200);
  });
});

describe("admin bookings API", () => {
  it("lists bookings with their customer, sorted by departure", async () => {
    const { api } = admin();
    const res = await api().get("/api/admin/bookings").set("X-Admin-Key", "adm");
    expect(res.body.bookings).toHaveLength(12);
    expect(res.body.bookings[0].departureDate).toBe("2026-08-01");
    expect(res.body.bookings[0].customer.lastName).toBe("Schulz");
  });

  it("creates a booking the voicebot can then verify", async () => {
    const { api } = admin();
    const created = await api().post("/api/admin/bookings").set("X-Admin-Key", "adm").send(NEW_BOOKING);
    expect(created.status).toBe(201);
    expect(created.body.booking).toMatchObject({ bookingNumber: "4711013", status: "confirmed", paymentStatus: "deposit_paid" });

    const verify = await api().post("/api/v1/auth/verify").set("X-Api-Key", "k")
      .send({ tis_id: "12345678", postal_code: "10117", travel_date: "10.09.2027" });
    expect(verify.body.result).toBe("verified");
    expect(verify.body.booking.destination).toBe("Sizilien, Italien");
  });

  it("validates new bookings", async () => {
    const { api } = admin();
    const bad = await api().post("/api/admin/bookings").set("X-Admin-Key", "adm").send({ ...NEW_BOOKING, returnDate: "2027-09-01" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain("returnDate");
    const unknown = await api().post("/api/admin/bookings").set("X-Admin-Key", "adm").send({ ...NEW_BOOKING, tisId: "11111111" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe("customer_not_found");
  });

  it("updates only the fields that were sent", async () => {
    const { api, store } = admin();
    const res = await api().patch("/api/admin/bookings/4711001").set("X-Admin-Key", "adm").send({ paymentStatus: "paid", amountPaid: 3480 });
    expect(res.status).toBe(200);
    const b = store.bookings.get("4711001")!;
    expect(b).toMatchObject({ paymentStatus: "paid", amountPaid: 3480, board: "all_inclusive", documentStatus: "pending" });
    expect(b.history.at(-1)!.event).toBe("edited_by_admin");
  });

  it("re-activating a cancelled booking drops the cancellation", async () => {
    const { api, store } = admin();
    await api().patch("/api/admin/bookings/4711007").set("X-Admin-Key", "adm").send({ status: "confirmed" }).expect(200);
    expect(store.bookings.get("4711007")!.cancellation).toBeUndefined();
  });

  it("rejects a return date before the departure date on update", async () => {
    const { api } = admin();
    await api().patch("/api/admin/bookings/4711001").set("X-Admin-Key", "adm").send({ returnDate: "2027-07-01" }).expect(400);
  });

  it("deletes a booking and revokes its sessions", async () => {
    const { api, store } = admin();
    await api().post("/api/v1/auth/verify").set("X-Api-Key", "k").set("X-Conversation-Id", "c")
      .send({ tis_id: "12345678", postal_code: "10117", travel_date: "2027-07-15" });
    await api().delete("/api/admin/bookings/4711001").set("X-Admin-Key", "adm").expect(204);
    expect(store.bookings.has("4711001")).toBe(false);
    await api().get("/api/v1/booking").set("X-Api-Key", "k").set("X-Conversation-Id", "c").expect(401);
    await api().delete("/api/admin/bookings/4711001").set("X-Admin-Key", "adm").expect(404);
  });
});

describe("admin customers API", () => {
  it("creates, updates and deletes customers", async () => {
    const { api, store } = admin();
    const c = { tisId: "13572468", salutation: "frau", firstName: "Eva", lastName: "Neumann", email: "eva@example.com", postalCode: "28195", city: "Bremen" };
    await api().post("/api/admin/customers").set("X-Admin-Key", "adm").send(c).expect(201);
    await api().post("/api/admin/customers").set("X-Admin-Key", "adm").send(c).expect(409);
    await api().put("/api/admin/customers/13572468").set("X-Admin-Key", "adm").send({ city: "Bremerhaven" }).expect(200);
    expect(store.customers.get("13572468")!.city).toBe("Bremerhaven");
    await api().delete("/api/admin/customers/13572468").set("X-Admin-Key", "adm").expect(204);
  });

  it("validates the TIS-ID and refuses to delete customers with bookings", async () => {
    const { api } = admin();
    await api().post("/api/admin/customers").set("X-Admin-Key", "adm")
      .send({ tisId: "1234", salutation: "herr", firstName: "A", lastName: "B", email: "a@b.de", postalCode: "12345" }).expect(400);
    const res = await api().delete("/api/admin/customers/12345678").set("X-Admin-Key", "adm");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("customer_has_bookings");
  });
});
