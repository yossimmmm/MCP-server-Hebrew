// src/nlu/gemini.ts
import { GoogleGenerativeAI, GoogleGenerativeAIError } from "@google/generative-ai";
const CANDIDATES = [
    process.env.LLM_MODEL, // honor env if provided
    "gemini-flash-latest", // fast + good for calls
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
].filter(Boolean);
function stripModelsPrefix(id) {
    return id.replace(/^models\//, "");
}
export class LlmSession {
    chat;
    modelName = "";
    constructor() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            throw new Error("GEMINI_API_KEY not set");
        const genAI = new GoogleGenerativeAI(apiKey);
        const system = [
            "You are a concise voice assistant for a phone call.",
            "Reply in the caller's language; if Hebrew is detected, answer in Hebrew.",
            "Keep replies short (1–2 sentences). Avoid emojis and transliteration.",
        ].join(" ");
        // Try candidates in order
        let lastErr = null;
        for (const raw of CANDIDATES) {
            const m = stripModelsPrefix(raw);
            try {
                const model = genAI.getGenerativeModel({ model: m, systemInstruction: system });
                this.chat = model.startChat({
                    history: [],
                    generationConfig: { temperature: 0.6, maxOutputTokens: 256 },
                });
                this.modelName = m;
                console.log(`[LLM] using model: ${m}`);
                return;
            }
            catch (e) {
                lastErr = e;
            }
        }
        throw lastErr || new Error("No usable Gemini model found");
    }
    async reply(userText) {
        try {
            const res = await this.chat.sendMessage(userText);
            let text = res.response?.text?.() ?? "";
            text = (text || "").replace(/\s+/g, " ").trim();
            return text || "סליחה, לא שמעתי טוב. אפשר לחזור?";
        }
        catch (e) {
            const msg = e?.message || String(e);
            if (e instanceof GoogleGenerativeAIError && /404|not found/i.test(msg)) {
                console.warn(`[LLM] ${this.modelName} not available, trying a fallback…`);
                // one-shot fallback to the next candidate
                for (const raw of CANDIDATES.map(stripModelsPrefix)) {
                    if (raw === this.modelName)
                        continue;
                    try {
                        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                        const model = genAI.getGenerativeModel({ model: raw });
                        this.chat = model.startChat({ history: [], generationConfig: { temperature: 0.6, maxOutputTokens: 256 } });
                        this.modelName = raw;
                        console.warn(`[LLM] switched to: ${raw}`);
                        const res2 = await this.chat.sendMessage(userText);
                        return (res2.response?.text?.() ?? "").trim() || "סליחה, לא שמעתי טוב. אפשר לחזור?";
                    }
                    catch { }
                }
            }
            console.error("[LLM] error:", msg);
            return "סליחה, נתקלה בעיה לרגע. אפשר לחזור על השאלה?";
        }
    }
}
//# sourceMappingURL=gemini.js.map