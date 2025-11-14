// src/nlu/waitingPhrases.ts
export type WaitingPhrase = {
  id: string;          // שם הקובץ ב-media/waiting (ללא סיומת)
  text: string;        // המשפט המקורי שהקלטנו
  weight: number;      // משקל לבחירה רנדומלית
  aliases?: string[];  // וריאציות טקסט דומות
};

export const WAITING_PHRASES: WaitingPhrase[] = [
  {
    id: "ken_betah",
    text: "כן בטח.",
    weight: 3,
    aliases: ["כן בטח", "כן בטח?", "כן, בטח"]
  },
  {
    id: "meule",
    text: "מעולה.",
    weight: 3,
    aliases: ["מעולה", "מעולה!", "מעולה לגמרי"]
  },
  {
    id: "meule_check",
    text: "מעולה, תן לי רגע לבדוק משהו קטן.",
    weight: 4,
    aliases: [
      "מעולה, תן לי רגע לבדוק",
      "מעולה, אני בודק רגע",
      "מעולה, שניה אני בודק משהו קטן",
      "מעולה, אני מציץ רגע"
    ]
  },
  {
    id: "sababa_check",
    text: "סבבה, שניה אני בודק משהו קטן.",
    weight: 4,
    aliases: [
      "סבבה, שניה אני בודק",
      "סבבה, אני בודק רגע",
      "סבבה, תן לי שניה לבדוק"
    ]
  },
  {
    id: "nice_organize",
    text: "אחלה, אני עושה לך רגע סדר בראש.",
    weight: 3,
    aliases: [
      "אחלה, אני עושה רגע סדר",
      "אחלה, אני מסדר לך את זה רגע",
      "אני עושה לך רגע סדר"
    ]
  },
  {
    id: "cool_look",
    text: "מגניב, אני מציץ רגע על מה שסיפרת.",
    weight: 2,
    aliases: [
      "מגניב, אני מציץ רגע",
      "מגניב, אני בודק את זה רגע",
      "מגניב, אני עובר על זה רגע"
    ]
  },
  {
    id: "ok_one_sec",
    text: "טוב, תן לי שניה לחשוב על זה.",
    weight: 2,
    aliases: [
      "טוב, תן לי שניה לחשוב",
      "רק שניה אני חושב על זה",
      "תן לי שניה לחשוב על זה"
    ]
  }
];

function normalizeHint(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[.,!?;:"'׳״()\-–—]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// בחירה רנדומלית לפי weight
export function pickWaitingPhrase(): WaitingPhrase {
  const total = WAITING_PHRASES.reduce(
    (sum, p) => sum + (p.weight > 0 ? p.weight : 1),
    0
  );
  let r = Math.random() * total;

  for (const p of WAITING_PHRASES) {
    const w = p.weight > 0 ? p.weight : 1;
    r -= w;
    if (r <= 0) return p;
  }

  return WAITING_PHRASES[0];
}

// בחירת משפט לפי hint מה-LLM (או נפילה לרנדום אם אין התאמה)
export function pickWaitingPhraseForHint(
  hint?: string | null
): WaitingPhrase {
  const normHint = normalizeHint(hint || "");
  if (!normHint) return pickWaitingPhrase();

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

  // לא מצאנו – פשוט רנדום
  return pickWaitingPhrase();
}
