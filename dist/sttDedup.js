// sttDedup.ts
const BIDI = /[\u200E\u200F\u061C]/g; // LRM, RLM, ALM
const PUNCT = /[.,!?，、؛…"'“”‘’]/g;
export function normalizeHebrew(s) {
    return (s || "")
        .normalize("NFKC")
        .replace(BIDI, "")
        .replace(PUNCT, "")
        .replace(/\s+/g, " ")
        .trim();
}
export function createFinalDeduper(msWindow = 2000) {
    let lastNorm = "";
    let lastAt = 0;
    return (text) => {
        const now = Date.now();
        const norm = normalizeHebrew(text);
        const isDup = norm && norm === lastNorm && now - lastAt < msWindow;
        if (!isDup && norm) {
            lastNorm = norm;
            lastAt = now;
            return true; // accept
        }
        return false; // drop duplicate
    };
}
//# sourceMappingURL=sttDedup.js.map