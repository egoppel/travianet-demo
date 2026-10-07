import type { Booking, Customer } from "../data/seed.js";
import { formatDate, label, type Lang } from "./i18n.js";

/**
 * Simulated email channel. Nothing is actually sent: every message the voicebot
 * triggers (payment link, travel documents, cancellation / rebooking
 * confirmation) is stored in the outbox and shown on the admin page.
 */

export type OutboxKind = "payment_link" | "documents" | "cancellation_confirmation" | "rebooking_confirmation";

export interface OutboxMessage {
  id: string;
  createdAt: string;
  kind: OutboxKind;
  to: string;
  customerName: string;
  bookingNumber: string;
  language: Lang;
  subject: string;
  body: string;
  /** Payment links only: URL of the mock payment page. */
  link?: string;
}

/** A payment link points to a mock payment page; paying there settles the balance. */
export interface PaymentLink {
  id: string;
  bookingNumber: string;
  amount: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
}

export function money(amount: number, currency: string, lang: Lang): string {
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB", { style: "currency", currency }).format(amount);
}

function greeting(c: Customer, lang: Lang): string {
  const name = `${label("salutation", c.salutation, lang)} ${c.lastName}`;
  if (lang === "en") return `Dear ${name},`;
  return c.salutation === "frau" ? `Sehr geehrte ${name},` : `Sehr geehrter ${name},`;
}

const SIGN_OFF: Record<Lang, string> = {
  de: "Mit freundlichen Grüßen\nIhr Travianet Reiseservice",
  en: "Kind regards\nYour Travianet travel service",
};

function trip(b: Booking, lang: Lang): string {
  return `${b.destination}, ${formatDate(b.departureDate, lang)} – ${formatDate(b.returnDate, lang)}`;
}

type Extra =
  | { kind: "payment_link"; amount: number; link: string }
  | { kind: "documents" }
  | { kind: "cancellation_confirmation"; fee: number; refund: number; stillDue: number }
  | { kind: "rebooking_confirmation"; newPrice: number };

export function composeMessage(c: Customer, b: Booking, lang: Lang, extra: Extra): Pick<OutboxMessage, "subject" | "body"> {
  const de = lang === "de";
  const head = `${greeting(c, lang)}\n\n`;
  const ref = de ? `Vorgang ${b.bookingNumber}: ${trip(b, lang)}` : `Booking ${b.bookingNumber}: ${trip(b, lang)}`;
  let subject: string;
  let text: string;
  switch (extra.kind) {
    case "payment_link":
      subject = de ? `Ihr Zahlungslink für Vorgang ${b.bookingNumber}` : `Your payment link for booking ${b.bookingNumber}`;
      text = de
        ? `wie telefonisch besprochen erhalten Sie hier Ihren Zahlungslink für die offene Restzahlung von ${money(extra.amount, b.currency, lang)}.\n\n${ref}\n\nJetzt bezahlen: ${extra.link}`
        : `as discussed on the phone, here is your payment link for the outstanding balance of ${money(extra.amount, b.currency, lang)}.\n\n${ref}\n\nPay now: ${extra.link}`;
      break;
    case "documents":
      subject = de ? `Ihre Reiseunterlagen für Vorgang ${b.bookingNumber}` : `Your travel documents for booking ${b.bookingNumber}`;
      text = de
        ? `anbei erhalten Sie Ihre Reiseunterlagen.\n\n${ref}\nHotel: ${b.hotel}\nHinflug: ${b.flightOutbound} ab ${b.departureAirport}\nRückflug: ${b.flightReturn}\n\n(Demo: Es sind keine Dateien angehängt.)`
        : `please find your travel documents attached.\n\n${ref}\nHotel: ${b.hotel}\nOutbound flight: ${b.flightOutbound} from ${b.departureAirport}\nReturn flight: ${b.flightReturn}\n\n(Demo: no files are attached.)`;
      break;
    case "cancellation_confirmation": {
      const settle = extra.refund > 0
        ? de ? `Wir erstatten Ihnen ${money(extra.refund, b.currency, lang)}.` : `We will refund ${money(extra.refund, b.currency, lang)}.`
        : extra.stillDue > 0
          ? de ? `Bitte überweisen Sie noch ${money(extra.stillDue, b.currency, lang)}.` : `Please transfer the remaining ${money(extra.stillDue, b.currency, lang)}.`
          : "";
      subject = de ? `Stornobestätigung für Vorgang ${b.bookingNumber}` : `Cancellation confirmation for booking ${b.bookingNumber}`;
      text = de
        ? `hiermit bestätigen wir die Stornierung Ihrer Reise.\n\n${ref}\nStornokosten: ${money(extra.fee, b.currency, lang)}\n${settle}`
        : `we hereby confirm the cancellation of your trip.\n\n${ref}\nCancellation fee: ${money(extra.fee, b.currency, lang)}\n${settle}`;
      break;
    }
    case "rebooking_confirmation":
      subject = de ? `Umbuchungsbestätigung für Vorgang ${b.bookingNumber}` : `Rebooking confirmation for booking ${b.bookingNumber}`;
      text = de
        ? `hiermit bestätigen wir die Umbuchung Ihrer Reise auf den neuen Termin.\n\n${ref}\nNeuer Reisepreis: ${money(extra.newPrice, b.currency, lang)}`
        : `we hereby confirm that your trip has been rebooked to the new dates.\n\n${ref}\nNew travel price: ${money(extra.newPrice, b.currency, lang)}`;
      break;
  }
  return { subject, body: `${head}${text.trim()}\n\n${SIGN_OFF[lang]}` };
}
