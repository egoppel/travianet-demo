import { describe, expect, it } from "vitest";
import { normalizePostalCode, normalizeTisId, parseTravelDate, spokenToDigits } from "../src/lib/normalize.js";

describe("spokenToDigits", () => {
  it.each([
    ["12345678", "12345678"],
    ["1234 5678", "12345678"],
    ["12-34-56-78", "12345678"],
    ["1 2 3 4 5 6 7 8", "12345678"],
    ["eins zwei drei vier fünf sechs sieben acht", "12345678"],
    ["Eins, Zwei, Drei, Vier, Fünf, Sechs, Sieben, Acht.", "12345678"],
    ["zwölf vierunddreißig sechsundfünfzig achtundsiebzig", "12345678"],
    ["zwo null doppel fünf eins drei", "205513"],
    ["Meine Nummer ist 1029 3847", "10293847"],
    ["es ist eine achtstellige Nummer: null eins null sechs sieben", "01067"],
    ["one two three four five six seven eight", "12345678"],
    ["twenty one", "21"],
    ["zehn neunundzwanzig achtunddreissig siebenundvierzig", "10293847"],
  ])("%s -> %s", (input, expected) => {
    expect(spokenToDigits(input)).toBe(expected);
  });
});

describe("normalizeTisId", () => {
  it("accepts 8 digits in any spoken form", () => {
    expect(normalizeTisId("zwölf vierunddreißig sechsundfünfzig achtundsiebzig")).toEqual({ ok: true, value: "12345678" });
    expect(normalizeTisId(12345678)).toEqual({ ok: true, value: "12345678" });
  });

  it("keeps leading zeros", () => {
    expect(normalizeTisId("01234567")).toEqual({ ok: true, value: "01234567" });
  });

  it("reports how many digits were understood", () => {
    expect(normalizeTisId("1234567")).toEqual({
      ok: false,
      problem: { field: "tis_id", code: "wrong_length", digits_received: 7, understood: "1234567" },
    });
    expect(normalizeTisId("")).toMatchObject({ ok: false, problem: { code: "missing" } });
  });
});

describe("normalizePostalCode", () => {
  it("accepts German (5) and Austrian/Swiss (4) postal codes", () => {
    expect(normalizePostalCode("null eins null sechs sieben")).toEqual({ ok: true, value: "01067" });
    expect(normalizePostalCode("1010")).toEqual({ ok: true, value: "1010" });
    expect(normalizePostalCode("123")).toMatchObject({ ok: false, problem: { code: "wrong_length" } });
  });
});

describe("parseTravelDate", () => {
  it.each([
    ["2026-11-14", { day: 14, month: 11, year: 2026 }],
    ["14.11.2026", { day: 14, month: 11, year: 2026 }],
    ["14.11.26", { day: 14, month: 11, year: 2026 }],
    ["14.11.", { day: 14, month: 11 }],
    ["14. November 2026", { day: 14, month: 11, year: 2026 }],
    ["am 14. november", { day: 14, month: 11 }],
    ["vierzehnter November", { day: 14, month: 11 }],
    ["am ersten Juni 2027", { day: 1, month: 6, year: 2027 }],
    ["15th July 2027", { day: 15, month: 7, year: 2027 }],
    ["24. Oktober", { day: 24, month: 10 }],
  ])("%s", (input, expected) => {
    expect(parseTravelDate(input)).toEqual(expected);
  });

  it("rejects impossible dates and noise", () => {
    expect(parseTravelDate("31.02.2027")).toBeNull();
    expect(parseTravelDate("nächste Woche")).toBeNull();
    expect(parseTravelDate("")).toBeNull();
  });
});
