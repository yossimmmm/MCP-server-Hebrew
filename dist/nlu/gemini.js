// src/nlu/gemini.ts
import { GoogleGenerativeAI, GoogleGenerativeAIError } from "@google/generative-ai";
const CANDIDATES = [
    process.env.LLM_MODEL, // honor env if provided
    "gemini-2.5-flash", // default first
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
].filter(Boolean);
function stripModelsPrefix(id) { return id.replace(/^models\//, ""); }
function withTimeout(p, ms = 5000, fallback) {
    let t;
    const timeout = new Promise((resolve) => {
        t = setTimeout(() => resolve(fallback()), ms);
    });
    return Promise.race([p.finally(() => clearTimeout(t)), timeout]);
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
            "You are a concise voice assistant for phone calls.",
            "Always answer in the caller's language. If Hebrew is detected, answer in Hebrew.",
            "Keep replies short and natural for speech (8–15 words). No emojis or transliteration.",
        ].join(" ");
        let lastErr = null;
        for (const raw of CANDIDATES) {
            const m = stripModelsPrefix(raw);
            try {
                const model = genAI.getGenerativeModel({ model: m, systemInstruction: system });
                this.chat = model.startChat({
                    history: [],
                    generationConfig: { temperature: 0.5, maxOutputTokens: 160 },
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
        const fallbackText = "סליחה, לא שמעתי טוב. אפשר לחזור?";
        try {
            const res = await withTimeout(this.chat.sendMessage(userText), Number(process.env.LLM_TIMEOUT_MS || 5000), () => ({ response: { text: () => fallbackText } }));
            let text = res.response?.text?.() ?? "";
            text = (text || "").replace(/\s+/g, " ").trim();
            return text || fallbackText;
        }
        catch (e) {
            const msg = e?.message || String(e);
            if (e instanceof GoogleGenerativeAIError && /404|not found/i.test(msg)) {
                console.warn(`[LLM] ${this.modelName} not available, trying a fallback…`);
                for (const raw of CANDIDATES.map(stripModelsPrefix)) {
                    if (raw === this.modelName)
                        continue;
                    try {
                        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                        const model = genAI.getGenerativeModel({ model: raw });
                        this.chat = model.startChat({ history: [], generationConfig: { temperature: 0.5, maxOutputTokens: 160 } });
                        this.modelName = raw;
                        const res2 = await this.chat.sendMessage(userText);
                        return (res2.response?.text?.() ?? "").trim() || fallbackText;
                    }
                    catch { }
                }
            }
            console.error("[LLM] error:", msg);
            return fallbackText;
        }
    }
}
