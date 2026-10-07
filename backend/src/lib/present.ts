import type { Booking, Customer } from "../data/seed.js";
import { formatDate, label, type Lang } from "./i18n.js";

/** Masks an email for read-back on the phone: "thomas.mueller@example.com" -> "t***r@example.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const masked = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}

export function presentCustomer(c: Customer, lang: Lang) {
  return {
    salutation: label("salutation", c.salutation, lang),
    first_name: c.firstName,
    last_name: c.lastName,
    email_masked: maskEmail(c.email),
  };
}

export function bookingSummary(b: Booking, lang: Lang) {
  return {
    booking_number: b.bookingNumber,
    destination: b.destination,
    departure_date: b.departureDate,
    departure_date_spoken: formatDate(b.departureDate, lang),
    status: b.status,
    status_label: label("status", b.status, lang),
  };
}

export function presentBooking(b: Booking, lang: Lang) {
  const balance = Math.max(0, b.priceTotal - b.amountPaid);
  return {
    ...bookingSummary(b, lang),
    tour_operator: b.tourOperator,
    hotel: b.hotel,
    room_type: b.roomType,
    board: b.board,
    board_label: label("board", b.board, lang),
    return_date: b.returnDate,
    return_date_spoken: formatDate(b.returnDate, lang),
    departure_airport: b.departureAirport,
    flight_outbound: b.flightOutbound,
    flight_return: b.flightReturn,
    travellers: b.travellers.map((t) => `${t.firstName} ${t.lastName}`),
    travel_insurance: b.travelInsurance,
    payment: {
      status: b.paymentStatus,
      status_label: label("payment", b.paymentStatus, lang),
      currency: b.currency,
      price_total: b.priceTotal,
      amount_paid: b.amountPaid,
      balance_due: balance,
      balance_due_date: b.balanceDueDate,
      balance_due_date_spoken: b.balanceDueDate ? formatDate(b.balanceDueDate, lang) : null,
    },
    documents: {
      status: b.documentStatus,
      status_label: label("documents", b.documentStatus, lang),
      available_from: b.documentsAvailableFrom,
      available_from_spoken: formatDate(b.documentsAvailableFrom, lang),
    },
    cancellation: b.cancellation
      ? { cancelled_at: b.cancellation.cancelledAt, fee: b.cancellation.fee, reason: b.cancellation.reason }
      : null,
  };
}
