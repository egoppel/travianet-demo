import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Booking } from "./data/seed.js";
import { money, type PaymentLink } from "./lib/outbox.js";
import { formatDate } from "./lib/i18n.js";
import { StoreError, type Store } from "./lib/store.js";

/**
 * Admin API for the booking web interface (/admin). All routes sit behind the
 * admin key check that app.ts applies. Bodies use the internal camelCase model.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const digits = (min: number, max: number) => z.string().regex(new RegExp(`^\\d{${min},${max}}$`), `expected ${min}-${max} digits`);

const CustomerFields = z.object({
  salutation: z.enum(["herr", "frau"]),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().default(""),
  street: z.string().default(""),
  postalCode: digits(4, 5),
  city: z.string().default(""),
  country: z.enum(["DE", "AT", "CH"]).default("DE"),
});
const CustomerCreate = CustomerFields.extend({ tisId: digits(8, 8) });

const BookingFields = z.object({
  tisId: digits(8, 8),
  status: z.enum(["confirmed", "cancelled", "completed"]).default("confirmed"),
  tourOperator: z.string().min(1),
  destination: z.string().min(1),
  hotel: z.string().min(1),
  roomType: z.string().default("Doppelzimmer"),
  board: z.enum(["room_only", "breakfast", "half_board", "full_board", "all_inclusive"]).default("breakfast"),
  departureDate: isoDate,
  returnDate: isoDate,
  departureAirport: z.string().default(""),
  flightOutbound: z.string().default(""),
  flightReturn: z.string().default(""),
  travellers: z.array(z.object({ firstName: z.string().min(1), lastName: z.string().min(1) })).min(1),
  priceTotal: z.coerce.number().nonnegative(),
  currency: z.enum(["EUR", "CHF"]).default("EUR"),
  amountPaid: z.coerce.number().nonnegative().default(0),
  balanceDueDate: isoDate.nullable().default(null),
  paymentStatus: z.enum(["paid", "deposit_paid", "overdue", "refund_pending", "refunded"]).default("deposit_paid"),
  documentStatus: z.enum(["pending", "available", "sent"]).default("pending"),
  documentsAvailableFrom: isoDate,
  travelInsurance: z.boolean().default(false),
});
const BookingCreate = BookingFields.extend({ bookingNumber: digits(5, 10).optional() }).refine(
  (b) => b.returnDate >= b.departureDate,
  { message: "returnDate must not be before departureDate", path: ["returnDate"] },
);

function parse<T>(schema: z.ZodType<T>, body: unknown, res: Response): T | null {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    res.status(400).json({ error: "bad_request", message: r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    return null;
  }
  return r.data;
}

export function createAdminRouter(store: Store): Router {
  const admin = express.Router();

  admin.post("/reset", (_req, res) => {
    store.reset();
    res.json({ result: "reset" });
  });

  admin.get("/state", (_req, res) => {
    res.json({
      sessions: [...store.sessions.values()].map((s) => ({ ...s, token: `${s.token.slice(0, 6)}…` })),
      conversations: Object.fromEntries(store.conversations),
      handovers: store.handovers,
      bookings: [...store.bookings.values()],
    });
  });

  admin.get("/customers", (_req, res) => {
    res.json({
      customers: [...store.customers.values()].map((c) => ({ ...c, bookingCount: store.bookingsOf(c.tisId).length })),
    });
  });
  admin.post("/customers", (req, res) => {
    const body = parse(CustomerCreate, req.body, res);
    if (body) res.status(201).json({ customer: store.createCustomer(body) });
  });
  admin.put("/customers/:tisId", (req, res) => {
    const body = parse(CustomerFields.partial(), req.body, res);
    if (body) res.json({ customer: store.updateCustomer(req.params.tisId, body) });
  });
  admin.delete("/customers/:tisId", (req, res) => {
    store.deleteCustomer(req.params.tisId);
    res.status(204).end();
  });

  admin.get("/bookings", (_req, res) => {
    res.json({
      bookings: [...store.bookings.values()]
        .sort((a, b) => a.departureDate.localeCompare(b.departureDate))
        .map((b) => ({ ...b, customer: store.customers.get(b.tisId) ?? null })),
    });
  });
  admin.post("/bookings", (req, res) => {
    const body = parse(BookingCreate, req.body, res);
    if (body) res.status(201).json({ booking: store.createBooking(body) });
  });
  admin.patch("/bookings/:number", (req, res) => {
    const body = parse(BookingFields.partial(), req.body, res);
    if (!body) return;
    // .partial() keeps .default() values -> only apply keys the client actually sent
    const sent = Object.fromEntries(Object.entries(body).filter(([k]) => k in (req.body ?? {})));
    const current = store.bookings.get(req.params.number);
    const dep = (sent.departureDate as string) ?? current?.departureDate;
    const ret = (sent.returnDate as string) ?? current?.returnDate;
    if (dep && ret && ret < dep) return res.status(400).json({ error: "bad_request", message: "returnDate: must not be before departureDate" });
    res.json({ booking: store.updateBooking(req.params.number, sent) });
  });
  admin.delete("/bookings/:number", (req, res) => {
    store.deleteBooking(req.params.number);
    res.status(204).end();
  });

  admin.get("/outbox", (_req, res) => {
    res.json({
      messages: [...store.outbox].reverse().map((m) => ({
        ...m,
        paidAt: m.link ? store.paymentLinks.get(m.link.split("/").pop()!)?.paidAt ?? null : undefined,
      })),
    });
  });

  admin.get("/handovers", (_req, res) => {
    res.json({ handovers: [...store.handovers].reverse() });
  });

  admin.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof StoreError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  });

  return admin;
}

/** The single-page web interface. Resolves to backend/public both from src/ (dev) and dist/ (build). */
export function adminPage(): string {
  return readFileSync(new URL("../public/admin.html", import.meta.url), "utf8");
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Mock payment page behind the payment link from the simulated email (German, no real payment). */
export function paymentPage(data: { link: PaymentLink; booking: Booking } | null): string {
  const body = !data
    ? `<h1>Link ungültig</h1><p>Dieser Zahlungslink ist nicht bekannt oder abgelaufen.</p>`
    : data.link.paidAt
      ? `<h1>Vielen Dank!</h1><p>Ihre Zahlung über <strong>${esc(money(data.link.amount, data.link.currency, "de"))}</strong> für Vorgang ${esc(data.booking.bookingNumber)} ist eingegangen.</p><p class="muted">Bezahlt am ${esc(new Date(data.link.paidAt).toLocaleString("de-DE"))}</p>`
      : `<h1>Restzahlung</h1>
         <dl><dt>Vorgang</dt><dd>${esc(data.booking.bookingNumber)}</dd>
         <dt>Reise</dt><dd>${esc(data.booking.destination)}, ${esc(formatDate(data.booking.departureDate, "de"))}</dd>
         <dt>Betrag</dt><dd class="amount">${esc(money(data.link.amount, data.link.currency, "de"))}</dd></dl>
         <form method="post"><button>Jetzt bezahlen</button></form>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Travianet Zahlung</title><style>
:root{--bg:#f6f7f9;--panel:#fff;--text:#1d2330;--muted:#667085;--line:#e3e6eb;--accent:#0b6bcb}
@media (prefers-color-scheme:dark){:root{--bg:#12151b;--panel:#1b1f27;--text:#e6e9ef;--muted:#98a2b3;--line:#2c323d;--accent:#4c9be8}}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:440px;margin:10vh auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 16px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 22px}dt{color:var(--muted)}dd{margin:0}
.amount{font-size:20px;font-weight:700}.muted{color:var(--muted)}.demo{margin-top:22px;font-size:12px;color:var(--muted)}
button{width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
</style></head><body><main>${body}<p class="demo">Demo von Travianet – es wird kein echtes Geld bewegt.</p></main></body></html>`;
}
