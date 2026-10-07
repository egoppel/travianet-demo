/**
 * Normalisation of caller input as it arrives from a speech-to-speech model.
 *
 * The LLM is asked to pass digits, but a voice model regularly hands over what
 * it heard verbatim: "eins zwei drei vier", "zwölf vierunddreißig", "1234 5678",
 * "doppel fünf", "14. November", "14.11.". Instead of letting the LLM decide
 * whether an input is valid (which is what failed in the customer's own
 * prototype), the backend normalises it deterministically and reports exactly
 * what it understood.
 */

const UNITS: Record<string, number> = {
  // German
  null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5,
  sechs: 6, sieben: 7, acht: 8, neun: 9,
  // English (so additional languages work without backend changes)
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9,
};

const TEENS: Record<string, number> = {
  zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15,
  sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70,
  achtzig: 80, neunzig: 90,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80,
  ninety: 90,
};

const ENGLISH_TENS = new Set(["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]);

/** Words that repeat the following number: "doppel fünf" = 55. */
const REPEATERS: Record<string, number> = { doppel: 2, double: 2, dreifach: 3, triple: 3 };

/** Standalone articles that must not be read as the digit 1 ("eine achtstellige Nummer"). */
const STANDALONE_EXCLUDED = new Set(["ein", "eine", "oh"]);

export function foldGerman(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFC")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/** Parses one alphabetic token that consists solely of number words, e.g. "vierunddreissig". */
function parseNumberWord(token: string): string | null {
  if (token in TEENS) return String(TEENS[token]);
  if (token in TENS) return String(TENS[token]);
  if (token in UNITS) return String(UNITS[token]);
  // German compound: <unit>und<tens>  -> "vierunddreissig" = 34
  const m = /^([a-z]+)und([a-z]+)$/.exec(token);
  if (m && m[1] in UNITS && m[2] in TENS && UNITS[m[1]] > 0) {
    return String(TENS[m[2]] + UNITS[m[1]]);
  }
  // Glued words without separators: "zweidreivier" -> "234" (only if fully consumed)
  return segment(token);
}

const LEXICON = Object.keys({ ...UNITS, ...TEENS, ...TENS }).sort((a, b) => b.length - a.length);

function segment(token: string): string | null {
  if (!token) return "";
  for (const word of LEXICON) {
    if (token.startsWith(word)) {
      const head = parseCompoundPrefix(token) ?? { value: parseSimple(word), len: word.length };
      const rest = segment(token.slice(head.len));
      if (rest !== null) return head.value + rest;
    }
  }
  return null;
}

function parseSimple(word: string): string {
  return String(TEENS[word] ?? TENS[word] ?? UNITS[word]);
}

function parseCompoundPrefix(token: string): { value: string; len: number } | null {
  const m = /^([a-z]+?)und([a-z]+?zig|dreissig)/.exec(token);
  if (m && m[1] in UNITS && m[2] in TENS && UNITS[m[1]] > 0) {
    return { value: String(TENS[m[2]] + UNITS[m[1]]), len: m[0].length };
  }
  return null;
}

/**
 * Converts a spoken / transcribed number sequence into a digit string.
 * Non-number words ("meine", "Nummer", "ist") are ignored.
 */
export function spokenToDigits(input: string): string {
  const folded = foldGerman(String(input ?? ""))
    // split digit/letter boundaries: "12drei" -> "12 drei"
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2");
  const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean);

  let out = "";
  let repeat = 1;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok in REPEATERS) {
      repeat = REPEATERS[tok];
      continue;
    }
    let value: string | null;
    if (/^\d+$/.test(tok)) {
      value = tok;
    } else if (STANDALONE_EXCLUDED.has(tok)) {
      value = null;
    } else {
      value = parseNumberWord(tok);
      // English "twenty one" -> 21
      if (value !== null && ENGLISH_TENS.has(tok) && tokens[i + 1] in UNITS && UNITS[tokens[i + 1]] > 0) {
        value = String(TENS[tok] + UNITS[tokens[i + 1]]);
        i++;
      }
    }
    if (value === null) {
      repeat = 1;
      continue;
    }
    out += value.repeat(repeat);
    repeat = 1;
  }
  return out;
}

export type FieldProblem =
  | { field: "tis_id"; code: "missing" | "wrong_length"; digits_received: number; understood: string }
  | { field: "postal_code"; code: "missing" | "wrong_length"; digits_received: number; understood: string }
  | { field: "travel_date"; code: "missing" | "unparseable"; understood: string };

export const TIS_ID_LENGTH = 8;

export function normalizeTisId(input: unknown): { ok: true; value: string } | { ok: false; problem: FieldProblem } {
  const digits = spokenToDigits(String(input ?? ""));
  if (!digits) return { ok: false, problem: { field: "tis_id", code: "missing", digits_received: 0, understood: "" } };
  if (digits.length !== TIS_ID_LENGTH) {
    return {
      ok: false,
      problem: { field: "tis_id", code: "wrong_length", digits_received: digits.length, understood: digits },
    };
  }
  return { ok: true, value: digits };
}

/** German postal codes have 5 digits, Austrian and Swiss ones 4. */
export function normalizePostalCode(input: unknown): { ok: true; value: string } | { ok: false; problem: FieldProblem } {
  const digits = spokenToDigits(String(input ?? ""));
  if (!digits) return { ok: false, problem: { field: "postal_code", code: "missing", digits_received: 0, understood: "" } };
  if (digits.length !== 4 && digits.length !== 5) {
    return {
      ok: false,
      problem: { field: "postal_code", code: "wrong_length", digits_received: digits.length, understood: digits },
    };
  }
  return { ok: true, value: digits };
}

export interface PartialDate {
  day: number;
  month: number;
  /** Undefined when the caller did not say a year ("am vierzehnten November"). */
  year?: number;
}

const MONTHS: Record<string, number> = {
  januar: 1, jaenner: 1, january: 1, jan: 1,
  februar: 2, feber: 2, february: 2, feb: 2,
  maerz: 3, march: 3, mar: 3, mrz: 3,
  april: 4, apr: 4,
  mai: 5, may: 5,
  juni: 6, june: 6, jun: 6,
  juli: 7, july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  oktober: 10, october: 10, okt: 10, oct: 10,
  november: 11, nov: 11,
  dezember: 12, december: 12, dez: 12, dec: 12,
};

function validDate(day: number, month: number, year?: number): PartialDate | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  if (year !== undefined) {
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1) return null;
    return { day, month, year };
  }
  return { day, month };
}

/** Strips German/English ordinal endings: "vierzehnten" -> "vierzehn", "14th" -> "14". */
function stripOrdinal(token: string): string {
  if (/^\d+(st|nd|rd|th|ter|te|ten)?$/.test(token)) return token.replace(/\D+$/, "");
  if (token === "ersten" || token === "erster" || token === "erste") return "eins";
  if (token === "dritten" || token === "dritter" || token === "dritte") return "drei";
  if (token === "siebten" || token === "siebter" || token === "siebte") return "sieben";
  if (token === "achten" || token === "achter" || token === "achte") return "acht";
  return token.replace(/(sten|ster|ste|ten|ter|te)$/, "");
}

export function parseTravelDate(input: unknown): PartialDate | null {
  const raw = foldGerman(String(input ?? "")).trim();
  if (!raw) return null;

  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (m) return validDate(+m[3], +m[2], +m[1]);

  m = /(\d{1,2})\s*[./]\s*(\d{1,2})\s*(?:[./]\s*(\d{2,4})?)?/.exec(raw);
  if (m) return validDate(+m[1], +m[2], m[3] ? +m[3] : undefined);

  // Word form: "14. November 2026", "vierzehnter november", "am 3 mai"
  const tokens = raw.split(/[^a-z0-9]+/).filter(Boolean);
  const mi = tokens.findIndex((t) => t in MONTHS);
  if (mi > 0) {
    const day = Number.parseInt(spokenToDigits(stripOrdinal(tokens[mi - 1])), 10);
    const yearTok = tokens.slice(mi + 1).find((t) => /^\d{2,4}$/.test(t));
    return validDate(day, MONTHS[tokens[mi]], yearTok ? +yearTok : undefined);
  }
  return null;
}

export function sameDay(date: PartialDate, isoDate: string): boolean {
  const [y, mo, d] = isoDate.split("-").map(Number);
  return date.day === d && date.month === mo && (date.year === undefined || date.year === y);
}
