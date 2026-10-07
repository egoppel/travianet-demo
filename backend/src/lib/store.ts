import { randomBytes } from "node:crypto";
import { bookings as seedBookings, customers as seedCustomers, type Booking, type Customer } from "../data/seed.js";
import type { Config } from "../config.js";
import {
  normalizePostalCode,
  normalizeTisId,
  parseTravelDate,
  sameDay,
  type FieldProblem,
  type PartialDate,
} from "./normalize.js";

export class StoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Session {
  token: string;
  tisId: string;
  bookingNumber: string;
  conversationId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

interface ConversationState {
  authAttempts: number;
  formatErrors: number;
  token: string | null;
}

export interface Handover {
  id: string;
  createdAt: string;
  conversationId: string | null;
  service: number;
  topic: string;
  verified: boolean;
  tisId: string | null;
  bookingNumber: string | null;
  summary: string;
  callerPhone: string | null;
  language: string;
}

export interface RebookOption {
  optionId: string;
  departureDate: string;
  returnDate: string;
  priceDifference: number;
  changeFee: number;
}

export type NextAction = "ask_topic" | "retry" | "continue_unverified";

export type VerifyResult =
  | {
      result: "verified";
      token: string;
      expiresAt: Date;
      customer: Customer;
      booking: Booking;
      otherBookings: Booking[];
      nextAction: "ask_topic";
    }
  | {
      result: "invalid_format" | "not_matched" | "attempts_exhausted";
      problems: FieldProblem[];
      understood: { tisId: string | null; postalCode: string | null; travelDate: PartialDate | null };
      attemptsUsed: number;
      attemptsRemaining: number;
      nextAction: "retry" | "continue_unverified";
    };

const DAY = 24 * 60 * 60 * 1000;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
}

/** Calendar days from `now` (UTC date) to `iso`. */
export function daysUntil(iso: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - today) / DAY);
}

/** Typical package-holiday cancellation scale (percentage of the travel price). */
export function cancellationPercentage(daysBeforeDeparture: number): number {
  if (daysBeforeDeparture >= 31) return 25;
  if (daysBeforeDeparture >= 22) return 40;
  if (daysBeforeDeparture >= 15) return 55;
  if (daysBeforeDeparture >= 7) return 75;
  return 90;
}

export const REBOOK_FEE_PER_TRAVELLER = 50;
/** Self-service rebooking is possible only until this many days before departure. */
export const REBOOK_MIN_DAYS = 31;

export class Store {
  customers = new Map<string, Customer>();
  bookings = new Map<string, Booking>();
  sessions = new Map<string, Session>();
  conversations = new Map<string, ConversationState>();
  handovers: Handover[] = [];
  rebookOptions = new Map<string, RebookOption[]>();

  constructor(
    private readonly config: Config,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.reset();
  }

  now(): Date {
    return this.clock();
  }

  reset(): void {
    this.customers = new Map(seedCustomers.map((c) => [c.tisId, structuredClone(c)]));
    this.bookings = new Map(seedBookings.map((b) => [b.bookingNumber, structuredClone(b)]));
    this.sessions.clear();
    this.conversations.clear();
    this.handovers = [];
    this.rebookOptions.clear();
  }

  private conversation(id: string | null): ConversationState {
    if (!id) return { authAttempts: 0, formatErrors: 0, token: null };
    let state = this.conversations.get(id);
    if (!state) {
      state = { authAttempts: 0, formatErrors: 0, token: null };
      this.conversations.set(id, state);
    }
    return state;
  }

  bookingsOf(tisId: string): Booking[] {
    return [...this.bookings.values()]
      .filter((b) => b.tisId === tisId)
      .sort((a, b) => a.departureDate.localeCompare(b.departureDate));
  }

  /** Format check for the "Angebotsanfrage" branch: does a customer with this TIS-ID exist? */
  checkTisId(input: unknown): { result: "found" | "not_found" | "invalid_format"; tisId: string | null; problem?: FieldProblem } {
    const tis = normalizeTisId(input);
    if (!tis.ok) return { result: "invalid_format", tisId: null, problem: tis.problem };
    return { result: this.customers.has(tis.value) ? "found" : "not_found", tisId: tis.value };
  }

  verify(input: { tisId: unknown; postalCode: unknown; travelDate: unknown }, conversationId: string | null): VerifyResult {
    const state = this.conversation(conversationId);
    const max = this.config.maxAuthAttempts;

    const tis = normalizeTisId(input.tisId);
    const plz = normalizePostalCode(input.postalCode);
    const date = parseTravelDate(input.travelDate);
    const understood = {
      tisId: tis.ok ? tis.value : null,
      postalCode: plz.ok ? plz.value : null,
      travelDate: date,
    };

    const exhausted = state.authAttempts >= max || state.formatErrors >= this.config.maxFormatErrors;
    if (exhausted) {
      return {
        result: "attempts_exhausted", problems: [], understood,
        attemptsUsed: state.authAttempts, attemptsRemaining: 0, nextAction: "continue_unverified",
      };
    }

    const problems: FieldProblem[] = [];
    if (!tis.ok) problems.push(tis.problem);
    if (!plz.ok) problems.push(plz.problem);
    if (!date) {
      problems.push({ field: "travel_date", code: input.travelDate ? "unparseable" : "missing", understood: String(input.travelDate ?? "") });
    }

    if (problems.length > 0) {
      // A misheard/incomplete input is not a wrong identity: it does not consume an
      // auth attempt, but it is capped so the caller can never get stuck in a loop.
      state.formatErrors++;
      const stillAllowed = state.formatErrors < this.config.maxFormatErrors;
      return {
        result: "invalid_format", problems, understood,
        attemptsUsed: state.authAttempts,
        attemptsRemaining: stillAllowed ? max - state.authAttempts : 0,
        nextAction: stillAllowed ? "retry" : "continue_unverified",
      };
    }

    const customer = this.customers.get(understood.tisId!);
    const booking =
      customer && customer.postalCode === understood.postalCode
        ? this.bookingsOf(customer.tisId).find((b) => sameDay(date!, b.departureDate))
        : undefined;

    if (!customer || !booking) {
      state.authAttempts++;
      const remaining = Math.max(0, max - state.authAttempts);
      return {
        result: "not_matched", problems: [], understood,
        attemptsUsed: state.authAttempts, attemptsRemaining: remaining,
        nextAction: remaining > 0 ? "retry" : "continue_unverified",
      };
    }

    const session = this.createSession(customer.tisId, booking.bookingNumber, conversationId);
    state.token = session.token;
    return {
      result: "verified",
      token: session.token,
      expiresAt: session.expiresAt,
      customer,
      booking,
      otherBookings: this.bookingsOf(customer.tisId).filter((b) => b.bookingNumber !== booking.bookingNumber),
      nextAction: "ask_topic",
    };
  }

  createSession(tisId: string, bookingNumber: string, conversationId: string | null): Session {
    const now = this.now();
    const session: Session = {
      token: randomBytes(24).toString("base64url"),
      tisId,
      bookingNumber,
      conversationId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.tokenTtlMinutes * 60 * 1000),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  /** Resolves a bearer token, or — for the voice channel — the token bound to a conversation. */
  resolveSession(token: string | null, conversationId: string | null): Session | "expired" | null {
    const t = token ?? (conversationId ? this.conversations.get(conversationId)?.token ?? null : null);
    if (!t) return null;
    const session = this.sessions.get(t);
    if (!session) return null;
    if (session.expiresAt.getTime() <= this.now().getTime()) {
      this.sessions.delete(t);
      return "expired";
    }
    return session;
  }

  revoke(token: string): void {
    const s = this.sessions.get(token);
    this.sessions.delete(token);
    if (s?.conversationId) {
      const c = this.conversations.get(s.conversationId);
      if (c && c.token === token) c.token = null;
    }
  }

  cancellationQuote(booking: Booking) {
    const days = daysUntil(booking.departureDate, this.now());
    const percentage = cancellationPercentage(Math.max(0, days));
    const fee = Math.round((booking.priceTotal * percentage) / 100);
    return {
      daysBeforeDeparture: days,
      percentage,
      fee,
      refundAmount: Math.max(0, booking.amountPaid - fee),
      amountStillDue: Math.max(0, fee - booking.amountPaid),
    };
  }

  cancel(booking: Booking, reason: string) {
    const quote = this.cancellationQuote(booking);
    booking.status = "cancelled";
    booking.cancellation = { cancelledAt: this.now().toISOString().slice(0, 10), fee: quote.fee, reason };
    booking.paymentStatus = quote.refundAmount > 0 ? "refund_pending" : booking.paymentStatus;
    booking.history.push({ at: this.now().toISOString().slice(0, 10), event: "cancelled" });
    return quote;
  }

  rebookingOptions(booking: Booking, preferred: PartialDate | null): RebookOption[] {
    const duration = daysUntil(booking.returnDate, new Date(`${booking.departureDate}T00:00:00Z`));
    const fee = REBOOK_FEE_PER_TRAVELLER * booking.travellers.length;
    let anchor = booking.departureDate;
    if (preferred) {
      const year = preferred.year ?? Number(booking.departureDate.slice(0, 4));
      anchor = `${year}-${String(preferred.month).padStart(2, "0")}-${String(preferred.day).padStart(2, "0")}`;
      if (daysUntil(anchor, this.now()) < 0) anchor = `${year + 1}${anchor.slice(4)}`;
    }
    const offsets = preferred ? [0, 7, -7] : [7, 14, -7];
    const earliest = REBOOK_MIN_DAYS;
    const options = offsets
      .map((o) => addDays(anchor, o))
      .filter((d) => d !== booking.departureDate && daysUntil(d, this.now()) >= earliest)
      .map((departureDate, i) => {
        const doy = Math.floor(Date.parse(`${departureDate}T00:00:00Z`) / DAY);
        // deterministic pseudo price difference per traveller: -80 .. +160 EUR
        const perPerson = ((doy * 37) % 7) * 40 - 80;
        return {
          optionId: `U${i + 1}`,
          departureDate,
          returnDate: addDays(departureDate, duration),
          priceDifference: perPerson * booking.travellers.length,
          changeFee: fee,
        };
      });
    this.rebookOptions.set(booking.bookingNumber, options);
    return options;
  }

  rebook(booking: Booking, optionId: string): RebookOption | null {
    const option = this.rebookOptions.get(booking.bookingNumber)?.find((o) => o.optionId === optionId.toUpperCase());
    if (!option) return null;
    booking.departureDate = option.departureDate;
    booking.returnDate = option.returnDate;
    booking.priceTotal += option.priceDifference + option.changeFee;
    if (booking.paymentStatus === "paid" && option.priceDifference + option.changeFee > 0) booking.paymentStatus = "deposit_paid";
    booking.history.push({ at: this.now().toISOString().slice(0, 10), event: `rebooked_to_${option.departureDate}` });
    this.rebookOptions.delete(booking.bookingNumber);
    return option;
  }

  // ---- admin (web interface) ----

  createCustomer(c: Customer): Customer {
    if (this.customers.has(c.tisId)) throw new StoreError(409, "customer_exists", `TIS-ID ${c.tisId} already exists.`);
    this.customers.set(c.tisId, c);
    return c;
  }

  updateCustomer(tisId: string, patch: Partial<Omit<Customer, "tisId">>): Customer {
    const c = this.customers.get(tisId);
    if (!c) throw new StoreError(404, "customer_not_found", `No customer with TIS-ID ${tisId}.`);
    Object.assign(c, patch);
    return c;
  }

  deleteCustomer(tisId: string): void {
    if (!this.customers.has(tisId)) throw new StoreError(404, "customer_not_found", `No customer with TIS-ID ${tisId}.`);
    if (this.bookingsOf(tisId).length) throw new StoreError(409, "customer_has_bookings", "Delete the customer's bookings first.");
    this.customers.delete(tisId);
  }

  nextBookingNumber(): string {
    const max = Math.max(4711000, ...[...this.bookings.keys()].map(Number).filter(Number.isFinite));
    return String(max + 1);
  }

  createBooking(b: Omit<Booking, "bookingNumber" | "history"> & { bookingNumber?: string }): Booking {
    if (!this.customers.has(b.tisId)) throw new StoreError(400, "customer_not_found", `No customer with TIS-ID ${b.tisId}.`);
    const bookingNumber = b.bookingNumber || this.nextBookingNumber();
    if (this.bookings.has(bookingNumber)) throw new StoreError(409, "booking_exists", `Booking ${bookingNumber} already exists.`);
    const booking: Booking = { ...b, bookingNumber, history: [{ at: this.now().toISOString().slice(0, 10), event: "created_by_admin" }] };
    this.bookings.set(bookingNumber, booking);
    return booking;
  }

  updateBooking(bookingNumber: string, patch: Partial<Omit<Booking, "bookingNumber" | "history">>): Booking {
    const b = this.bookings.get(bookingNumber);
    if (!b) throw new StoreError(404, "booking_not_found", `No booking ${bookingNumber}.`);
    if (patch.tisId && !this.customers.has(patch.tisId)) throw new StoreError(400, "customer_not_found", `No customer with TIS-ID ${patch.tisId}.`);
    Object.assign(b, patch);
    if (patch.status && patch.status !== "cancelled") delete b.cancellation;
    b.history.push({ at: this.now().toISOString().slice(0, 10), event: "edited_by_admin" });
    this.rebookOptions.delete(bookingNumber);
    return b;
  }

  deleteBooking(bookingNumber: string): void {
    if (!this.bookings.delete(bookingNumber)) throw new StoreError(404, "booking_not_found", `No booking ${bookingNumber}.`);
    for (const [token, s] of this.sessions) if (s.bookingNumber === bookingNumber) this.revoke(token);
  }

  addHandover(h: Omit<Handover, "id" | "createdAt">): Handover {
    const handover: Handover = {
      ...h,
      id: `HO-${String(this.handovers.length + 1).padStart(4, "0")}`,
      createdAt: this.now().toISOString(),
    };
    this.handovers.push(handover);
    return handover;
  }
}
