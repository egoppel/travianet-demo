/**
 * Labels for codes the API returns. Every response carries the machine code AND
 * a label in the requested language, so the voice agent can read out natural
 * text without translating it itself. To add a language, add one more entry per
 * dictionary — nothing else in the backend is language specific.
 */

export const SUPPORTED_LANGUAGES = ["de", "en"] as const;
export type Lang = (typeof SUPPORTED_LANGUAGES)[number];

type Dict = Record<string, Record<Lang, string>>;

const labels: Record<string, Dict> = {
  status: {
    confirmed: { de: "bestätigt", en: "confirmed" },
    cancelled: { de: "storniert", en: "cancelled" },
    completed: { de: "abgeschlossen (Reise beendet)", en: "completed (trip finished)" },
  },
  payment: {
    paid: { de: "vollständig bezahlt", en: "paid in full" },
    deposit_paid: { de: "Anzahlung bezahlt, Restzahlung offen", en: "deposit paid, balance outstanding" },
    overdue: { de: "Restzahlung überfällig", en: "balance overdue" },
    refund_pending: { de: "Erstattung in Bearbeitung", en: "refund in progress" },
    refunded: { de: "erstattet", en: "refunded" },
  },
  documents: {
    pending: { de: "noch nicht verfügbar", en: "not yet available" },
    available: { de: "verfügbar, noch nicht versendet", en: "available, not yet sent" },
    sent: { de: "per E-Mail versendet", en: "sent by email" },
  },
  board: {
    room_only: { de: "ohne Verpflegung", en: "room only" },
    breakfast: { de: "Frühstück", en: "breakfast" },
    half_board: { de: "Halbpension", en: "half board" },
    full_board: { de: "Vollpension", en: "full board" },
    all_inclusive: { de: "All inclusive", en: "all inclusive" },
  },
  salutation: {
    herr: { de: "Herr", en: "Mr" },
    frau: { de: "Frau", en: "Ms" },
  },
};

export function label(group: keyof typeof labels, code: string, lang: Lang): string {
  return labels[group]?.[code]?.[lang] ?? code;
}

/** Picks the first supported language from an Accept-Language header or `?lang=`. */
export function resolveLang(input: string | undefined, fallback: string): Lang {
  const candidates = (input ?? "")
    .split(",")
    .map((p) => p.split(";")[0].trim().slice(0, 2).toLowerCase())
    .filter(Boolean);
  for (const c of [...candidates, fallback]) {
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(c)) return c as Lang;
  }
  return "de";
}

/** "2026-11-14" -> "14.11.2026" (de) / "14 November 2026" (en). */
export function formatDate(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}
