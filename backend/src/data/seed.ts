/**
 * Demo data for the Travianet voicebot. All persons, addresses and bookings are
 * fictional. Dates are fixed (not relative to "today") so that demo callers can
 * use the same identification data every time; the cancellation fee is computed
 * against the real current date.
 *
 * Quick reference for demo calls (TIS-ID / PLZ / Reisedatum):
 *   12345678 / 10117 / 15.07.2027   Max Mustermann, Ibiza            (easy demo number)
 *   10293847 / 80331 / 14.11.2026   Thomas Müller, Mallorca           (2 bookings)
 *   10293847 / 80331 / 20.05.2027   Thomas Müller, Kreta              (deposit paid)
 *   20481516 / 50667 / 24.10.2026   Anna Schmidt, Antalya             (documents sent)
 *   31415926 / 20095 / 28.12.2026   Petra Wagner, Dubai               (balance overdue)
 *   27182818 / 10115 / 06.02.2027   Mehmet Yılmaz, Teneriffa
 *   16180339 / 60311 / 12.03.2027   Julia Becker, Malediven           (already cancelled)
 *   55501234 / 70173 / 10.10.2026   Lukas Hoffmann, Rom               (departure in a few days)
 *   87654321 / 01067 / 01.06.2027   Sabine Koch, Hurtigruten          (cruise)
 *   44556677 / 1010  / 09.01.2027   Stefan Fischer, Gran Canaria      (Austria, 4-digit PLZ)
 *   99887766 / 8001  / 02.04.2027   Laura Weber, Kapstadt             (Switzerland)
 *   64209753 / 04109 / 01.08.2026   Maria Schulz, Rhodos              (trip completed)
 */

export type Salutation = "herr" | "frau";
export type BookingStatus = "confirmed" | "cancelled" | "completed";
export type PaymentStatus = "paid" | "deposit_paid" | "overdue" | "refund_pending" | "refunded";
export type DocumentStatus = "pending" | "available" | "sent";
export type Board = "room_only" | "breakfast" | "half_board" | "full_board" | "all_inclusive";

export interface Customer {
  tisId: string;
  salutation: Salutation;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  postalCode: string;
  city: string;
  country: "DE" | "AT" | "CH";
}

export interface Traveller {
  firstName: string;
  lastName: string;
}

export interface Booking {
  /** Vorgangsnummer */
  bookingNumber: string;
  tisId: string;
  status: BookingStatus;
  tourOperator: string;
  destination: string;
  hotel: string;
  roomType: string;
  board: Board;
  departureDate: string;
  returnDate: string;
  departureAirport: string;
  flightOutbound: string;
  flightReturn: string;
  travellers: Traveller[];
  priceTotal: number;
  currency: "EUR" | "CHF";
  amountPaid: number;
  balanceDueDate: string | null;
  paymentStatus: PaymentStatus;
  documentStatus: DocumentStatus;
  documentsAvailableFrom: string;
  travelInsurance: boolean;
  cancellation?: { cancelledAt: string; fee: number; reason: string };
  history: { at: string; event: string }[];
}

export const customers: Customer[] = [
  { tisId: "12345678", salutation: "herr", firstName: "Max", lastName: "Mustermann", email: "max.mustermann@example.com", phone: "+4930123456", street: "Unter den Linden 1", postalCode: "10117", city: "Berlin", country: "DE" },
  { tisId: "10293847", salutation: "herr", firstName: "Thomas", lastName: "Müller", email: "thomas.mueller@example.com", phone: "+4989123456", street: "Marienplatz 8", postalCode: "80331", city: "München", country: "DE" },
  { tisId: "20481516", salutation: "frau", firstName: "Anna", lastName: "Schmidt", email: "anna.schmidt@example.com", phone: "+49221123456", street: "Hohe Straße 12", postalCode: "50667", city: "Köln", country: "DE" },
  { tisId: "31415926", salutation: "frau", firstName: "Petra", lastName: "Wagner", email: "petra.wagner@example.com", phone: "+4940123456", street: "Mönckebergstraße 7", postalCode: "20095", city: "Hamburg", country: "DE" },
  { tisId: "27182818", salutation: "herr", firstName: "Mehmet", lastName: "Yılmaz", email: "mehmet.yilmaz@example.com", phone: "+4930654321", street: "Invalidenstraße 50", postalCode: "10115", city: "Berlin", country: "DE" },
  { tisId: "16180339", salutation: "frau", firstName: "Julia", lastName: "Becker", email: "julia.becker@example.com", phone: "+4969123456", street: "Zeil 21", postalCode: "60311", city: "Frankfurt am Main", country: "DE" },
  { tisId: "55501234", salutation: "herr", firstName: "Lukas", lastName: "Hoffmann", email: "lukas.hoffmann@example.com", phone: "+49711123456", street: "Königstraße 3", postalCode: "70173", city: "Stuttgart", country: "DE" },
  { tisId: "87654321", salutation: "frau", firstName: "Sabine", lastName: "Koch", email: "sabine.koch@example.com", phone: "+49351123456", street: "Prager Straße 4", postalCode: "01067", city: "Dresden", country: "DE" },
  { tisId: "44556677", salutation: "herr", firstName: "Stefan", lastName: "Fischer", email: "stefan.fischer@example.at", phone: "+431123456", street: "Kärntner Straße 10", postalCode: "1010", city: "Wien", country: "AT" },
  { tisId: "99887766", salutation: "frau", firstName: "Laura", lastName: "Weber", email: "laura.weber@example.ch", phone: "+41441234567", street: "Bahnhofstrasse 30", postalCode: "8001", city: "Zürich", country: "CH" },
  { tisId: "64209753", salutation: "frau", firstName: "Maria", lastName: "Schulz", email: "maria.schulz@example.com", phone: "+49341123456", street: "Grimmaische Straße 2", postalCode: "04109", city: "Leipzig", country: "DE" },
];

export const bookings: Booking[] = [
  {
    bookingNumber: "4711001", tisId: "12345678", status: "confirmed", tourOperator: "Sonnenklar Reisen",
    destination: "Ibiza, Spanien", hotel: "Hotel Cala Llonga Beach", roomType: "Doppelzimmer Meerblick", board: "all_inclusive",
    departureDate: "2027-07-15", returnDate: "2027-07-29", departureAirport: "Berlin BER",
    flightOutbound: "EW 8540", flightReturn: "EW 8541",
    travellers: [{ firstName: "Max", lastName: "Mustermann" }, { firstName: "Erika", lastName: "Mustermann" }],
    priceTotal: 3480, currency: "EUR", amountPaid: 696, balanceDueDate: "2027-06-15", paymentStatus: "deposit_paid",
    documentStatus: "pending", documentsAvailableFrom: "2027-07-01", travelInsurance: true,
    history: [{ at: "2026-09-02", event: "booked" }],
  },
  {
    bookingNumber: "4711002", tisId: "10293847", status: "confirmed", tourOperator: "Alltours",
    destination: "Mallorca, Spanien", hotel: "Hotel Son Moll", roomType: "Doppelzimmer", board: "half_board",
    departureDate: "2026-11-14", returnDate: "2026-11-21", departureAirport: "München MUC",
    flightOutbound: "DE 1520", flightReturn: "DE 1521",
    travellers: [{ firstName: "Thomas", lastName: "Müller" }, { firstName: "Claudia", lastName: "Müller" }],
    priceTotal: 1890, currency: "EUR", amountPaid: 1890, balanceDueDate: null, paymentStatus: "paid",
    documentStatus: "available", documentsAvailableFrom: "2026-10-01", travelInsurance: false,
    history: [{ at: "2026-06-11", event: "booked" }, { at: "2026-09-14", event: "balance_paid" }],
  },
  {
    bookingNumber: "4711003", tisId: "10293847", status: "confirmed", tourOperator: "TUI",
    destination: "Kreta, Griechenland", hotel: "Aldemar Knossos Royal", roomType: "Familienzimmer", board: "all_inclusive",
    departureDate: "2027-05-20", returnDate: "2027-06-03", departureAirport: "München MUC",
    flightOutbound: "X3 2214", flightReturn: "X3 2215",
    travellers: [
      { firstName: "Thomas", lastName: "Müller" }, { firstName: "Claudia", lastName: "Müller" },
      { firstName: "Leon", lastName: "Müller" }, { firstName: "Mia", lastName: "Müller" },
    ],
    priceTotal: 6240, currency: "EUR", amountPaid: 1248, balanceDueDate: "2027-04-20", paymentStatus: "deposit_paid",
    documentStatus: "pending", documentsAvailableFrom: "2027-05-06", travelInsurance: true,
    history: [{ at: "2026-09-28", event: "booked" }],
  },
  {
    bookingNumber: "4711004", tisId: "20481516", status: "confirmed", tourOperator: "FTI",
    destination: "Antalya, Türkei", hotel: "Rixos Downtown", roomType: "Einzelzimmer", board: "all_inclusive",
    departureDate: "2026-10-24", returnDate: "2026-10-31", departureAirport: "Köln/Bonn CGN",
    flightOutbound: "XQ 951", flightReturn: "XQ 952",
    travellers: [{ firstName: "Anna", lastName: "Schmidt" }],
    priceTotal: 1120, currency: "EUR", amountPaid: 1120, balanceDueDate: null, paymentStatus: "paid",
    documentStatus: "sent", documentsAvailableFrom: "2026-10-03", travelInsurance: false,
    history: [{ at: "2026-07-03", event: "booked" }, { at: "2026-09-24", event: "balance_paid" }, { at: "2026-10-03", event: "documents_sent" }],
  },
  {
    bookingNumber: "4711005", tisId: "31415926", status: "confirmed", tourOperator: "DERTOUR",
    destination: "Dubai, Vereinigte Arabische Emirate", hotel: "Jumeirah Beach Hotel", roomType: "Deluxe Doppelzimmer", board: "breakfast",
    departureDate: "2026-12-28", returnDate: "2027-01-04", departureAirport: "Hamburg HAM",
    flightOutbound: "EK 60", flightReturn: "EK 59",
    travellers: [{ firstName: "Petra", lastName: "Wagner" }, { firstName: "Jürgen", lastName: "Wagner" }],
    priceTotal: 5320, currency: "EUR", amountPaid: 1064, balanceDueDate: "2026-09-28", paymentStatus: "overdue",
    documentStatus: "pending", documentsAvailableFrom: "2026-12-14", travelInsurance: true,
    history: [{ at: "2026-05-19", event: "booked" }, { at: "2026-10-02", event: "payment_reminder_sent" }],
  },
  {
    bookingNumber: "4711006", tisId: "27182818", status: "confirmed", tourOperator: "Sonnenklar Reisen",
    destination: "Teneriffa, Spanien", hotel: "Hotel Botanico", roomType: "Doppelzimmer", board: "breakfast",
    departureDate: "2027-02-06", returnDate: "2027-02-20", departureAirport: "Berlin BER",
    flightOutbound: "FR 1234", flightReturn: "FR 1235",
    travellers: [{ firstName: "Mehmet", lastName: "Yılmaz" }, { firstName: "Ayşe", lastName: "Yılmaz" }],
    priceTotal: 2760, currency: "EUR", amountPaid: 552, balanceDueDate: "2027-01-06", paymentStatus: "deposit_paid",
    documentStatus: "pending", documentsAvailableFrom: "2027-01-23", travelInsurance: false,
    history: [{ at: "2026-08-15", event: "booked" }],
  },
  {
    bookingNumber: "4711007", tisId: "16180339", status: "cancelled", tourOperator: "Meier's Weltreisen",
    destination: "Malediven", hotel: "Sun Island Resort", roomType: "Wasserbungalow", board: "full_board",
    departureDate: "2027-03-12", returnDate: "2027-03-26", departureAirport: "Frankfurt FRA",
    flightOutbound: "QR 68", flightReturn: "QR 67",
    travellers: [{ firstName: "Julia", lastName: "Becker" }, { firstName: "Daniel", lastName: "Becker" }],
    priceTotal: 8900, currency: "EUR", amountPaid: 1780, balanceDueDate: null, paymentStatus: "refund_pending",
    documentStatus: "pending", documentsAvailableFrom: "2027-02-26", travelInsurance: true,
    cancellation: { cancelledAt: "2026-09-30", fee: 2225, reason: "Krankheit" },
    history: [{ at: "2026-04-02", event: "booked" }, { at: "2026-09-30", event: "cancelled" }],
  },
  {
    bookingNumber: "4711008", tisId: "55501234", status: "confirmed", tourOperator: "Ameropa",
    destination: "Rom, Italien", hotel: "Hotel Artemide", roomType: "Doppelzimmer", board: "breakfast",
    departureDate: "2026-10-10", returnDate: "2026-10-13", departureAirport: "Stuttgart STR",
    flightOutbound: "AZ 433", flightReturn: "AZ 432",
    travellers: [{ firstName: "Lukas", lastName: "Hoffmann" }, { firstName: "Sophie", lastName: "Hoffmann" }],
    priceTotal: 1340, currency: "EUR", amountPaid: 1340, balanceDueDate: null, paymentStatus: "paid",
    documentStatus: "sent", documentsAvailableFrom: "2026-09-26", travelInsurance: false,
    history: [{ at: "2026-08-01", event: "booked" }, { at: "2026-09-10", event: "balance_paid" }, { at: "2026-09-26", event: "documents_sent" }],
  },
  {
    bookingNumber: "4711009", tisId: "87654321", status: "confirmed", tourOperator: "Hurtigruten",
    destination: "Norwegen, Postschiffroute Bergen – Kirkenes", hotel: "MS Richard With", roomType: "Außenkabine", board: "full_board",
    departureDate: "2027-06-01", returnDate: "2027-06-12", departureAirport: "Dresden DRS",
    flightOutbound: "LH 1234", flightReturn: "LH 1235",
    travellers: [{ firstName: "Sabine", lastName: "Koch" }, { firstName: "Frank", lastName: "Koch" }],
    priceTotal: 7480, currency: "EUR", amountPaid: 1496, balanceDueDate: "2027-05-01", paymentStatus: "deposit_paid",
    documentStatus: "pending", documentsAvailableFrom: "2027-05-18", travelInsurance: true,
    history: [{ at: "2026-09-12", event: "booked" }],
  },
  {
    bookingNumber: "4711010", tisId: "44556677", status: "confirmed", tourOperator: "Jahn Reisen",
    destination: "Gran Canaria, Spanien", hotel: "Lopesan Costa Meloneras", roomType: "Doppelzimmer", board: "half_board",
    departureDate: "2027-01-09", returnDate: "2027-01-16", departureAirport: "Wien VIE",
    flightOutbound: "OS 8301", flightReturn: "OS 8302",
    travellers: [{ firstName: "Stefan", lastName: "Fischer" }],
    priceTotal: 1450, currency: "EUR", amountPaid: 290, balanceDueDate: "2026-12-09", paymentStatus: "deposit_paid",
    documentStatus: "pending", documentsAvailableFrom: "2026-12-26", travelInsurance: false,
    history: [{ at: "2026-09-20", event: "booked" }],
  },
  {
    bookingNumber: "4711011", tisId: "99887766", status: "confirmed", tourOperator: "Kuoni",
    destination: "Kapstadt, Südafrika", hotel: "The Table Bay Hotel", roomType: "Doppelzimmer Hafenblick", board: "breakfast",
    departureDate: "2027-04-02", returnDate: "2027-04-16", departureAirport: "Zürich ZRH",
    flightOutbound: "LX 288", flightReturn: "LX 289",
    travellers: [{ firstName: "Laura", lastName: "Weber" }, { firstName: "Nico", lastName: "Weber" }],
    priceTotal: 9200, currency: "CHF", amountPaid: 1840, balanceDueDate: "2027-03-02", paymentStatus: "deposit_paid",
    documentStatus: "pending", documentsAvailableFrom: "2027-03-19", travelInsurance: true,
    history: [{ at: "2026-07-22", event: "booked" }],
  },
  {
    bookingNumber: "4711012", tisId: "64209753", status: "completed", tourOperator: "Alltours",
    destination: "Rhodos, Griechenland", hotel: "Lindos Mare", roomType: "Doppelzimmer", board: "half_board",
    departureDate: "2026-08-01", returnDate: "2026-08-15", departureAirport: "Leipzig/Halle LEJ",
    flightOutbound: "DE 1650", flightReturn: "DE 1651",
    travellers: [{ firstName: "Maria", lastName: "Schulz" }, { firstName: "Peter", lastName: "Schulz" }],
    priceTotal: 2980, currency: "EUR", amountPaid: 2980, balanceDueDate: null, paymentStatus: "paid",
    documentStatus: "sent", documentsAvailableFrom: "2026-07-18", travelInsurance: false,
    history: [{ at: "2026-02-14", event: "booked" }, { at: "2026-07-01", event: "balance_paid" }, { at: "2026-07-18", event: "documents_sent" }],
  },
];
