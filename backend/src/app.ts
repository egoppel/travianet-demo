import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { pinoHttp } from "pino-http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { logger } from "./lib/logger.js";
import { resolveLang, formatDate, type Lang } from "./lib/i18n.js";
import { bookingSummary, maskEmail, presentBooking, presentCustomer } from "./lib/present.js";
import { parseTravelDate } from "./lib/normalize.js";
import { REBOOK_MIN_DAYS, daysUntil, type Session, type Store } from "./lib/store.js";
import type { Booking } from "./data/seed.js";

declare module "express-serve-static-core" {
  interface Request {
    lang: Lang;
    conversationId: string | null;
    session?: Session;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Inputs arrive from an LLM: accept numbers as well as strings. */
const loose = z.union([z.string(), z.number()]).transform((v) => String(v));

const VerifyBody = z.object({
  tis_id: loose.optional(),
  postal_code: loose.optional(),
  travel_date: loose.optional(),
});

const HandoverBody = z.object({
  service: z.coerce.number().int().refine((n) => [2, 3, 4].includes(n), "service must be 2, 3 or 4"),
  topic: z.string().min(1),
  summary: z.string().default(""),
  tis_id: loose.optional(),
  caller_phone: loose.optional(),
});

function sendError(res: Response, status: number, error: string, message: string, extra: object = {}) {
  res.status(status).json({ error, message, ...extra });
}

export function createApp({ config, store }: { config: Config; store: Store }): Express {
  const app = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url?.split("?")[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(cors());
  app.use(express.json());

  app.use((req, _res, next) => {
    req.lang = resolveLang((req.query.lang as string) ?? req.get("accept-language"), config.defaultLanguage);
    const conv = req.get("x-conversation-id")?.trim();
    // LiveHub leaves an unresolved placeholder as-is when the variable is missing (e.g. in text chats)
    req.conversationId = conv && !conv.startsWith("{") ? conv : null;
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: store.now().toISOString() });
  });

  // ---- API key (shared secret configured on the LiveHub tools) ----
  const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
    if (!config.apiKey) return next();
    const key = req.get("x-api-key") ?? "";
    if (!safeEqual(key, config.apiKey)) return sendError(res, 401, "invalid_api_key", "Missing or invalid X-Api-Key header.");
    next();
  };

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!config.adminKey) {
      if (!config.apiKey) return next(); // local dev without any keys
      return sendError(res, 403, "admin_disabled", "Set ADMIN_KEY to enable admin routes.");
    }
    if (!safeEqual(req.get("x-admin-key") ?? "", config.adminKey)) {
      return sendError(res, 401, "invalid_admin_key", "Missing or invalid X-Admin-Key header.");
    }
    next();
  };

  // ---- customer token (result of identification) ----
  const requireToken = (req: Request, res: Response, next: NextFunction) => {
    const auth = req.get("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() ?? null;
    const token = bearer && !bearer.startsWith("{") ? bearer : null;
    const session = store.resolveSession(token, req.conversationId);
    if (session === "expired") {
      return sendError(res, 401, "token_expired", "The authorization has expired. Identify the caller again.", { next_action: "verify_identity" });
    }
    if (!session) {
      return sendError(res, 401, "not_verified", "Caller is not verified. Run identification first.", { next_action: "verify_identity" });
    }
    req.session = session;
    next();
  };

  const v1 = express.Router();
  v1.use(requireApiKey);

  // ---- identification & authorization ----
  v1.post("/auth/verify", (req, res) => {
    const body = VerifyBody.safeParse(req.body ?? {});
    if (!body.success) return sendError(res, 400, "bad_request", body.error.message);
    const r = store.verify(
      { tisId: body.data.tis_id, postalCode: body.data.postal_code, travelDate: body.data.travel_date },
      req.conversationId,
    );
    const lang = req.lang;
    if (r.result === "verified") {
      req.log.info({ tisId: r.customer.tisId, booking: r.booking.bookingNumber }, "caller verified");
      return res.json({
        result: "verified",
        token: r.token,
        token_type: "Bearer",
        expires_at: r.expiresAt.toISOString(),
        customer: presentCustomer(r.customer, lang),
        booking: presentBooking(r.booking, lang),
        other_bookings: r.otherBookings.map((b) => bookingSummary(b, lang)),
        next_action: r.nextAction,
      });
    }
    req.log.info({ result: r.result, attemptsUsed: r.attemptsUsed, problems: r.problems }, "verification failed");
    res.json({
      result: r.result,
      problems: r.problems,
      understood: {
        tis_id: r.understood.tisId,
        postal_code: r.understood.postalCode,
        travel_date: r.understood.travelDate,
      },
      attempts_used: r.attemptsUsed,
      attempts_remaining: r.attemptsRemaining,
      next_action: r.nextAction,
    });
  });

  v1.get("/auth/session", requireToken, (req, res) => {
    const s = req.session!;
    res.json({ tis_id: s.tisId, booking_number: s.bookingNumber, expires_at: s.expiresAt.toISOString() });
  });

  v1.post("/auth/logout", requireToken, (req, res) => {
    store.revoke(req.session!.token);
    res.json({ result: "logged_out" });
  });

  /** Offer branch of the flowchart: is the TIS-ID known? Returns no personal data. */
  v1.post("/tis/check", (req, res) => {
    const r = store.checkTisId(req.body?.tis_id);
    res.json({ result: r.result, tis_id: r.tisId, problem: r.problem ?? null });
  });

  // ---- bookings (token required) ----
  v1.get("/bookings", requireToken, (req, res) => {
    res.json({ bookings: store.bookingsOf(req.session!.tisId).map((b) => bookingSummary(b, req.lang)) });
  });

  const booking = express.Router({ mergeParams: true });
  booking.use(requireToken, (req, res, next) => {
    const ref = (req.params as { ref?: string }).ref;
    const number = !ref || ref === "current" ? req.session!.bookingNumber : ref;
    const b = store.bookings.get(number);
    if (!b || b.tisId !== req.session!.tisId) return sendError(res, 404, "booking_not_found", "No such booking for this customer.");
    res.locals.booking = b;
    next();
  });

  booking.get("/", (req, res) => {
    res.json({ booking: presentBooking(res.locals.booking as Booking, req.lang) });
  });

  booking.get("/cancellation-quote", (req, res) => {
    const b = res.locals.booking as Booking;
    if (b.status !== "confirmed") return res.json({ result: "not_cancellable", status: b.status });
    const q = store.cancellationQuote(b);
    res.json({
      result: "quote",
      currency: b.currency,
      price_total: b.priceTotal,
      days_before_departure: q.daysBeforeDeparture,
      cancellation_percentage: q.percentage,
      cancellation_fee: q.fee,
      amount_paid: b.amountPaid,
      refund_amount: q.refundAmount,
      amount_still_due: q.amountStillDue,
      travel_insurance: b.travelInsurance,
    });
  });

  booking.post("/cancel", (req, res) => {
    const b = res.locals.booking as Booking;
    const confirmed = req.body?.confirmed === true || req.body?.confirmed === "true";
    if (!confirmed) return sendError(res, 400, "confirmation_required", "Set confirmed=true after the caller agreed to the fee.");
    if (b.status !== "confirmed") return res.json({ result: "not_cancellable", status: b.status });
    const q = store.cancel(b, String(req.body?.reason ?? ""));
    req.log.info({ booking: b.bookingNumber, fee: q.fee }, "booking cancelled");
    res.json({
      result: "cancelled",
      booking_number: b.bookingNumber,
      currency: b.currency,
      cancellation_fee: q.fee,
      refund_amount: q.refundAmount,
      amount_still_due: q.amountStillDue,
      confirmation_sent_to: maskEmail(store.customers.get(b.tisId)!.email),
    });
  });

  booking.post("/rebooking-options", (req, res) => {
    const b = res.locals.booking as Booking;
    if (b.status !== "confirmed") return res.json({ result: "not_rebookable", reason: "status", status: b.status });
    const days = daysUntil(b.departureDate, store.now());
    if (days < REBOOK_MIN_DAYS) {
      return res.json({ result: "not_rebookable", reason: "too_close_to_departure", days_before_departure: days, minimum_days: REBOOK_MIN_DAYS });
    }
    const preferred = req.body?.preferred_date ? parseTravelDate(req.body.preferred_date) : null;
    const options = store.rebookingOptions(b, preferred);
    res.json({
      result: options.length ? "options" : "no_options",
      currency: b.currency,
      current_departure_date: b.departureDate,
      options: options.map((o) => ({
        option_id: o.optionId,
        departure_date: o.departureDate,
        departure_date_spoken: formatDate(o.departureDate, req.lang),
        return_date: o.returnDate,
        return_date_spoken: formatDate(o.returnDate, req.lang),
        price_difference: o.priceDifference,
        change_fee: o.changeFee,
        total_extra_cost: o.priceDifference + o.changeFee,
      })),
    });
  });

  booking.post("/rebook", (req, res) => {
    const b = res.locals.booking as Booking;
    const optionId = String(req.body?.option_id ?? "");
    const confirmed = req.body?.confirmed === true || req.body?.confirmed === "true";
    if (!confirmed) return sendError(res, 400, "confirmation_required", "Set confirmed=true after the caller agreed to the new dates and costs.");
    const o = store.rebook(b, optionId);
    if (!o) return sendError(res, 409, "unknown_option", "Unknown option_id. Request rebooking options first.");
    res.json({
      result: "rebooked",
      booking_number: b.bookingNumber,
      new_departure_date: o.departureDate,
      new_departure_date_spoken: formatDate(o.departureDate, req.lang),
      new_return_date: o.returnDate,
      new_return_date_spoken: formatDate(o.returnDate, req.lang),
      new_price_total: b.priceTotal,
      currency: b.currency,
      confirmation_sent_to: maskEmail(store.customers.get(b.tisId)!.email),
    });
  });

  booking.post("/documents/resend", (req, res) => {
    const b = res.locals.booking as Booking;
    const email = maskEmail(store.customers.get(b.tisId)!.email);
    if (b.status === "cancelled") return res.json({ result: "not_available", reason: "cancelled" });
    if (b.documentStatus === "pending") {
      return res.json({ result: "not_yet_available", available_from: b.documentsAvailableFrom, available_from_spoken: formatDate(b.documentsAvailableFrom, req.lang) });
    }
    b.documentStatus = "sent";
    b.history.push({ at: store.now().toISOString().slice(0, 10), event: "documents_sent" });
    res.json({ result: "sent", sent_to: email });
  });

  booking.post("/payment-link", (req, res) => {
    const b = res.locals.booking as Booking;
    const balance = Math.max(0, b.priceTotal - b.amountPaid);
    if (balance === 0 || b.status !== "confirmed") return res.json({ result: "nothing_to_pay" });
    res.json({ result: "sent", amount: balance, currency: b.currency, sent_to: maskEmail(store.customers.get(b.tisId)!.email) });
  });

  v1.use("/booking", booking);
  v1.use("/bookings/:ref", booking);

  // ---- hand-over to Sikom (flowchart: "Datenübergabe an Service von travianet") ----
  v1.post("/handovers", (req, res) => {
    const body = HandoverBody.safeParse(req.body ?? {});
    if (!body.success) return sendError(res, 400, "bad_request", body.error.message);
    const token = /^Bearer\s+(.+)$/i.exec(req.get("authorization") ?? "")?.[1] ?? null;
    const session = store.resolveSession(token, req.conversationId);
    const verified = !!session && session !== "expired";
    const tis = verified ? (session as Session).tisId : body.data.tis_id ? store.checkTisId(body.data.tis_id).tisId : null;
    const h = store.addHandover({
      conversationId: req.conversationId,
      service: body.data.service,
      topic: body.data.topic,
      summary: body.data.summary,
      verified,
      tisId: tis,
      bookingNumber: verified ? (session as Session).bookingNumber : null,
      callerPhone: (() => {
        const phone = body.data.caller_phone ?? req.get("x-caller") ?? "";
        return phone && !phone.startsWith("{") ? phone : null;
      })(),
      language: req.lang,
    });
    req.log.info({ handover: h.id, service: h.service, verified }, "handover created");
    res.status(201).json({ result: "created", handover_id: h.id, service: h.service, verified });
  });

  v1.get("/handovers", requireAdmin, (_req, res) => {
    res.json({ handovers: store.handovers });
  });

  app.use("/api/v1", v1);

  // ---- admin / demo helpers ----
  const admin = express.Router();
  admin.use(requireAdmin);
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
      customers: [...store.customers.values()].map((c) => ({
        tis_id: c.tisId,
        name: `${c.firstName} ${c.lastName}`,
        postal_code: c.postalCode,
        bookings: store.bookingsOf(c.tisId).map((b) => ({ booking_number: b.bookingNumber, departure_date: b.departureDate, destination: b.destination, status: b.status })),
      })),
    });
  });
  app.use("/api/admin", admin);

  app.use((_req, res) => sendError(res, 404, "not_found", "Route not found."));
  app.use((err: Error & { status?: number; type?: string }, req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.parse.failed") return sendError(res, 400, "bad_json", "Request body is not valid JSON.");
    req.log?.error({ err }, "unhandled error");
    sendError(res, err.status ?? 500, "internal_error", "Unexpected error.");
  });

  return app;
}
