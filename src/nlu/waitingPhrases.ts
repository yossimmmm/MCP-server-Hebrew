// src/nlu/waitingPhrases.ts

export type WaitingPhrase = {
  id: string;        // file name in media/waiting (without extension)
  text: string;      // full text, can include tone tags like [happy]
  aliases?: string[]; // optional textual variants (used only for matching)
};

export const WAITING_PHRASES: WaitingPhrase[] = [
  { id: "p_01", text: "[happy] כן בטח!" },
  { id: "p_02", text: "[happy] נשמע מעולה!" },
  { id: "p_03", text: "[bright] איזה יופי!" },
  { id: "p_04", text: "[upbeat] אחלה, מתאים לגמרי!" },
  { id: "p_05", text: "[happy] יופי, זה נשמע מצוין." },
  { id: "p_06", text: "[calm] אין בעיה." },
  { id: "p_07", text: "[neutral] נשמע טוב." },
  { id: "p_08", text: "[calm] בסדר גמור." },
  { id: "p_09", text: "[neutral] אוקיי, מבין." },
  { id: "p_10", text: "[neutral] סבבה." },
  { id: "p_16", text: "[friendly] אהבתי!" },
  { id: "p_17", text: "[warm] אחלה דבר אמרת." },
  { id: "p_18", text: "[warm] יופי, זה מסתדר לי." },
  { id: "p_19", text: "[friendly] מבין אותך לגמרי." },
  { id: "p_20", text: "[warm] תענוג לשמוע." },
  { id: "p_21", text: "[upbeat] יאללה סבבה!" },
  { id: "p_22", text: "[friendly] ברור אחי." },
  { id: "p_23", text: "[bright] וואלה יפה!" },
  { id: "p_24", text: "[happy] מגניב בטירוף!" },
  { id: "p_25", text: "[friendly] אחלה של דבר." },
  { id: "p_26", text: "[happy] מעולה!" },
  { id: "p_27", text: "[neutral] כן." },
  { id: "p_28", text: "[friendly] יופי." },
  { id: "p_29", text: "[calm] בסדר." },
  { id: "p_30", text: "[bright] סגור!" },
];

// normalize for fuzzy matching (used when LLM returns text, not id)
function normalizeHint(s: string): string {
  return (s || "")
    // remove leading [tag] if exists
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .toLowerCase()
    .replace(/[.,!?;:"'׳״()\[\]\-–—]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map LLM hint → WaitingPhrase.
 *
 * Behavior:
 * 1. If the hint matches an id exactly (e.g. "p_01") → return that phrase.
 * 2. Otherwise, try to match by text / aliases (Hebrew phrase).
 * 3. If nothing matches → return null (no random fallback).
 */
export function pickWaitingPhraseForHint(
  hint?: string | null
): WaitingPhrase | null {
  if (!hint) return null;

  const raw = hint.trim();
  if (!raw) return null;

  // direct id match: "p_01", "p_02", ...
  const byId = WAITING_PHRASES.find((p) => p.id === raw);
  if (byId) return byId;

  const normHint = normalizeHint(raw);
  if (!normHint) return null;

  // text / aliases match (LLM returns the phrase itself)
  for (const p of WAITING_PHRASES) {
    const variants = [p.text, ...(p.aliases ?? [])];
    for (const v of variants) {
      const nv = normalizeHint(v);
      if (!nv) continue;
      if (
        nv === normHint ||
        nv.includes(normHint) ||
        normHint.includes(nv)
      ) {
        return p;
      }
    }
  }

  // no random fallback – if there is no clear match, we prefer "no clip"
  return null;
}
