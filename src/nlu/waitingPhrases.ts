// src/nlu/waitingPhrases.ts

export type WaitingPhrase = {
  id: string;         // file name in media/waiting (without extension)
  text: string;       // full text, can include tone tags like [happy]
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

// extract leading tone tag: [happy] → "happy"
function extractToneTag(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].trim().toLowerCase() || null;
}

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
 * 2. Otherwise, we:
 *    - Parse an optional tone tag from the hint, e.g. "[happy] כן בטח!".
 *    - Normalize the text part ("כן בטח").
 *    - Scan all phrases (text + aliases) and score matches:
 *        • +2 for exact normalized text match.
 *        • +1 for partial text match (includes / included).
 *        • +2 extra if tone tag from hint == tone tag of phrase.
 *      The phrase with the highest score wins.
 *      Ties are broken deterministically by the order in WAITING_PHRASES (לא אקראי).
 * 3. If nothing matches → return null (no random fallback).
 *
 * כדי לקבל בחירה לפי ה-[tone]:
 * - אם יש כמה וריאציות של "כן בטח" עם טאגים שונים, למשל:
 *     "[happy] כן בטח!", "[calm] כן בטח!"
 *   תן ל-LLM להחזיר waiting_hint בסגנון:
 *     "[happy] כן בטח!" או "[calm] כן בטח!"
 *   ואז הפונקציה תבחר את הווריאציה עם אותו הטאג.
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

  const hintTone = extractToneTag(raw);     // e.g. "happy"
  const normHint = normalizeHint(raw);     // e.g. "כן בטח"

  if (!normHint) return null;

  type Scored = {
    phrase: WaitingPhrase;
    score: number;
    index: number;
  };

  let best: Scored | null = null;

  WAITING_PHRASES.forEach((phrase, index) => {
    const variants = [phrase.text, ...(phrase.aliases ?? [])];

    for (const v of variants) {
      const vNorm = normalizeHint(v);
      if (!vNorm) continue;

      let score = 0;

      if (vNorm === normHint) {
        // exact text match
        score = 2;
      } else if (vNorm.includes(normHint) || normHint.includes(vNorm)) {
        // partial text match
        score = 1;
      }

      if (score === 0) continue;

      const vTone = extractToneTag(v);
      if (hintTone && vTone && vTone === hintTone) {
        // tone tag match, e.g. both [happy]
        score += 2;
      }

      if (
        !best ||
        score > best.score ||
        (score === best.score && index < best.index)
      ) {
        best = { phrase, score, index };
      }
    }
  });

  return best ? best.phrase : null;
}
