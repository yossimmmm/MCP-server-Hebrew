export type WaitingPhrase = {
  id: string;         // file name in media/waiting (without extension)
  text: string;       // full text, can include tone tags like [happy]
  aliases?: string[]; // optional textual variants (used only for matching)
};

export const WAITING_PHRASES: WaitingPhrase[] = [
  { id: "x_01", text: "[happy] כן בטח… [breath] תראה…" },
  { id: "x_02", text: "[friendly] נשמע מעולה… [chuckle] בוא נתחיל." },
  { id: "x_03", text: "[bright] איזה יופי! [sigh] תשמע…" },
  { id: "x_04", text: "[happy] יאללה, סגור! [breath] אז ככה…" },
  { id: "x_05", text: "[upbeat] מעולה! [thinking] בוא נראה…" },
  { id: "x_06", text: "[calm] אין בעיה… [breath] אני אסביר לך." },
  { id: "x_07", text: "[neutral] אוקיי… [clears_throat] אז ככה…" },
  { id: "x_08", text: "[neutral] טוב, מבין… [thinking] תן לי להגיד לך משהו." },
  { id: "x_09", text: "[calm] סבבה… [breath] עכשיו תראה." },
  { id: "x_10", text: "[soft] בסדר גמור… [sigh] פשוט תקשיב שנייה." },
  { id: "x_11", text: "[chuckle] וואלה יפה… [happy] אז תראה…" },
  { id: "x_12", text: "[laugh] גדול… [breath] תקשיב שנייה." },
  { id: "x_13", text: "[chokes] אופס… [happy] טוב, אז ככה…" },
  { id: "x_14", text: "[friendly] אחלה! [sigh] עכשיו רגע…" },
  { id: "x_15", text: "[playful] מגניב בטירוף! [breath] יאללה…" },
  { id: "x_16", text: "[approving] מצוין… [breath] זה מה שאני מציע:" },
  { id: "x_17", text: "[friendly] ברור לגמרי… [thinking] אז ככה זה עובד." },
  { id: "x_18", text: "[calm] נשמע מדויק… [breath] עכשיו תקשיב." },
  { id: "x_19", text: "[warm] תענוג… [sigh] בוא נעשה סדר." },
  { id: "x_20", text: "[neutral] טוב מאוד… [breath] בוא נמשיך." },
  { id: "x_21", text: "[upbeat] יאללה סבבה… [breath] הנה מה שאני אומר." },
  { id: "x_22", text: "[friendly] ברור אחי… [chuckle] תקשיב." },
  { id: "x_23", text: "[bright] וואלה פצצה… [breath] אז תראה מה הולך פה." },
  { id: "x_24", text: "[happy] אחלה לגמרי… [thinking] זה מה שעולה לי." },
  { id: "x_25", text: "[friendly] סגור סגור… [breath] בוא נצלול." },
  { id: "x_26", text: "[happy] יופי… [breath]" },
  { id: "x_27", text: "[neutral] כן… [thinking]" },
  { id: "x_28", text: "[bright] מעולה… [breath]" },
  { id: "x_29", text: "[calm] בסדר… [sigh]" },
  { id: "x_30", text: "[friendly] אחלה… [breath]" },
  { id: "x_31", text: "[approving] מצוין… [breath] הנה מה שאני מציע." },
  { id: "x_32", text: "[neutral] ברור… [thinking] זה הכיוון הנכון." },
  { id: "x_33", text: "[calm] טוב מאוד… [breath] ככה נתקדם." },
  { id: "x_34", text: "[professional] מצפה לזה… [breath] אז תראה." },
  { id: "x_35", text: "[approving] מובן… [thinking] זה מה שחשוב לדעת." },
  { id: "x_36", text: "[friendly] מצוין… [breath] הנה השלב הבא." },
  { id: "x_37", text: "[neutral] הכל ברור… [breath] אני ממשיך." },
  { id: "x_38", text: "[approving] נשמע מדויק… [thinking] אז ככה זה עובד." },
  { id: "x_39", text: "[calm] סגור… [breath] אני אסביר את זה פשוט." },
  { id: "x_40", text: "[professional] לגמרי… [breath] בוא ניישר קו." },
  { id: "x_41", text: "[calm] הכל טוב… [breath] תן לי להראות לך." },
  { id: "x_42", text: "[soft] בסדר גמור… [sigh] הנה מה שקורה." },
  { id: "x_43", text: "[calm] רגוע… [breath] אז תראה…" },
  { id: "x_44", text: "[warm] יופי… [soft] פשוט תקשיב רגע." },
  { id: "x_45", text: "[calm] אין לחץ… [breath] אני אתן לך תמונה ברורה." },
  { id: "x_46", text: "[soft] סבבה לגמרי… [sigh] נסביר את זה לאט." },
  { id: "x_47", text: "[calm] תענוג… [breath] עכשיו נלך צעד צעד." },
  { id: "x_48", text: "[warm] מצוין… [soft] הנה איך אני רואה את זה." },
  { id: "x_49", text: "[calm] ברור… [breath] הכל מסתדר." },
  { id: "x_50", text: "[soft] טוב… [sigh] בוא נעבור על זה בנחת." },
];

// Extract leading tone tag: [happy] → "happy"
function extractToneTag(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^\s*\[([^\]]+)\]/);
  if (!m) return null;
  return m[1].trim().toLowerCase() || null;
}

// Normalize for fuzzy matching (used when LLM returns text, not id)
function normalizeHint(s: string): string {
  return (s || "")
    .toLowerCase()
    // remove any tags like [happy], [breath], [sigh] anywhere in the string
    .replace(/\[[^\]]+\]/g, "")
    // strip basic punctuation
    .replace(/[.,!?;:"'׳״()\-\–—]/g, "")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map an LLM hint → WaitingPhrase.
 *
 * Behavior:
 * 1. If hint matches an id exactly (e.g. "x_01") → return that phrase.
 * 2. Otherwise:
 *    - Parse optional tone tag from the hint, e.g. "[happy] כן בטח!".
 *    - Normalize the text portion ("כן בטח").
 *    - Scan all phrases (text + aliases) and score matches:
 *        • +2 for exact normalized text match.
 *        • +1 for partial text match (includes / included).
 *        • +2 extra if tone tag from hint == tone tag of phrase.
 *      The phrase with the highest score wins.
 *      Ties are broken deterministically by the order in WAITING_PHRASES.
 * 3. If lastId is provided, we try to avoid returning the same id twice
 *    in a row if there is any other candidate with the best score.
 * 4. If nothing matches → return null (no random fallback).
 */
export function pickWaitingPhraseForHint(
  hint?: string | null,
  lastId?: string | null
): WaitingPhrase | null {
  if (!hint) return null;

  const raw = hint.trim();
  if (!raw) return null;

  // Direct id match: "x_01", "x_02", ...
  const byId = WAITING_PHRASES.find((p) => p.id === raw);
  if (byId) return byId;

  const hintTone = extractToneTag(raw);
  const normHint = normalizeHint(raw);

  if (!normHint) return null;

  type Scored = {
    phrase: WaitingPhrase;
    score: number;
    index: number;
  };

  let bestAny: Scored | null = null;
  let bestDifferent: Scored | null = null;

  WAITING_PHRASES.forEach((phrase, index) => {
    const variants = [phrase.text, ...(phrase.aliases ?? [])];

    for (const v of variants) {
      const vNorm = normalizeHint(v);
      if (!vNorm) continue;

      let score = 0;

      if (vNorm === normHint) {
        score = 2; // exact text match
      } else if (vNorm.includes(normHint) || normHint.includes(vNorm)) {
        score = 1; // partial match
      }

      if (score === 0) continue;

      const vTone = extractToneTag(v);
      if (hintTone && vTone && vTone === hintTone) {
        score += 2; // tone tag match
      }

      const scored: Scored = { phrase, score, index };

      // Track best overall
      if (
        !bestAny ||
        score > bestAny.score ||
        (score === bestAny.score && index < bestAny.index)
      ) {
        bestAny = scored;
      }

      // Track best that is not the same id as lastId
      if (phrase.id !== lastId) {
        if (
          !bestDifferent ||
          score > bestDifferent.score ||
          (score === bestDifferent.score && index < bestDifferent.index)
        ) {
          bestDifferent = scored;
        }
      }
    }
  });

  if (!bestAny) {
    console.warn("[WAIT] no matching waiting phrase for hint:", hint);
    return null;
  }

  // Prefer a different id than lastId if we have a good candidate
  if (lastId && bestDifferent) {
    return bestDifferent.phrase;
  }

  return bestAny.phrase;
}
