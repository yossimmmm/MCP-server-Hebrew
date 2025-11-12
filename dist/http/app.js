// src/http/app.ts
import express from "express";
import cors from "cors";
import { Readable } from "node:stream";
const XI_API = "https://api.elevenlabs.io/v1";
export function createHttpApp() {
    const app = express();
    app.use(cors({ origin: "*", maxAge: 600 }));
    app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
    app.get("/stream/tts", async (req, res) => {
        try {
            const text = String(req.query.text || "");
            if (!text.trim()) {
                return res.status(400).json({ error: "Missing 'text' query param" });
            }
            const voiceId = req.query.voice_id ||
                process.env.ELEVENLABS_VOICE_ID ||
                "";
            if (!voiceId) {
                return res
                    .status(400)
                    .json({ error: "voice_id required (or set ELEVENLABS_VOICE_ID)" });
            }
            const model = String(req.query.model || process.env.DEFAULT_MODEL || "eleven_v3");
            const output_format = String(req.query.output_format ||
                process.env.DEFAULT_OUTPUT_FORMAT ||
                "mp3_44100_128");
            const apiKey = process.env.ELEVENLABS_API_KEY;
            if (!apiKey) {
                return res.status(500).json({ error: "ELEVENLABS_API_KEY not set" });
            }
            // Build querystring for ElevenLabs stream endpoint
            const qs = new URLSearchParams();
            qs.set("output_format", output_format);
            // v3 לא תומך ב-optimize_streaming_latency — נאפשר רק אם זה *לא* v3
            const optLat = req.query.optimize_streaming_latency ??
                process.env.OPTIMIZE_STREAMING_LATENCY;
            if (!model.startsWith("eleven_v3") && optLat != null) {
                qs.set("optimize_streaming_latency", String(optLat));
            }
            const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?${qs.toString()}`;
            // --- Debug logs (ללא הדפסת הטקסט עצמו) ---
            console.log("[TTS upstream] POST", url, "model:", model);
            const body = {
                text,
                model_id: model,
                // אל תשלח voice_settings/speed ל-v3 אם לא חייבים
            };
            const upstream = await fetch(url, {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "content-type": "application/json",
                    accept: "audio/mpeg",
                },
                body: JSON.stringify(body),
            });
            const ct = upstream.headers.get("content-type") || "";
            console.log(`[TTS upstream] status=${upstream.status} content-type=${ct}`);
            // אם ה-upstream נכשל או אין body → החזר 502 עם פירוט
            if (!upstream.ok || !upstream.body) {
                const msg = await upstream.text().catch(() => upstream.statusText);
                console.error(`[TTS upstream] ERROR ${upstream.status}: ${msg}`);
                return res.status(502).json({
                    error: "elevenlabs upstream error",
                    upstream_status: upstream.status,
                    model_tried: model,
                    voice_id: voiceId,
                    msg,
                });
            }
            // אם לא קיבלנו אודיו אמיתי → החזר 502 עם דוגמית טקסט לתחקור
            if (!ct.includes("audio/mpeg")) {
                const preview = await upstream.text().catch(() => "");
                console.error(`[TTS upstream] Non-audio response (${ct}): ${preview.slice(0, 500)}`);
                return res.status(502).json({
                    error: "elevenlabs non-audio",
                    upstream_status: upstream.status,
                    model_tried: model,
                    voice_id: voiceId,
                    ct,
                    msg: preview.slice(0, 500),
                });
            }
            // Pass-through של ה-MP3 החי
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Cache-Control", "no-store");
            Readable.fromWeb(upstream.body).pipe(res);
        }
        catch (err) {
            console.error("TTS error:", err);
            res
                .status(500)
                .json({ error: "internal", message: err?.message || String(err) });
        }
    });
    return app;
}
export default createHttpApp;
//# sourceMappingURL=app.js.map