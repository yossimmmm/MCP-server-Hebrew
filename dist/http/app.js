// src/http/app.ts (רק הראוט /stream/tts)
import express from "express";
import cors from "cors";
import { Readable } from "node:stream";
const XI_API = "https://api.elevenlabs.io/v1";
export function createHttpApp() {
    const app = express();
    app.use(cors({ origin: "*", maxAge: 600 }));
    app.use(express.json({ limit: "1mb" }));
    app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
    app.get("/stream/tts", async (req, res) => {
        try {
            const text = String(req.query.text || "");
            if (!text.trim())
                return res.status(400).json({ error: "Missing 'text' query param" });
            const voiceId = req.query.voice_id || process.env.ELEVENLABS_VOICE_ID || "";
            if (!voiceId)
                return res.status(400).json({ error: "voice_id required (or set ELEVENLABS_VOICE_ID)" });
            const model = String(req.query.model || process.env.DEFAULT_MODEL || "eleven_v3");
            const speed = req.query.speed !== undefined ? Number(req.query.speed) : 1.0;
            if (Number.isNaN(speed) || speed < 0.5 || speed > 1.5) {
                return res.status(400).json({ error: "speed must be 0.5–1.5" });
            }
            const output_format = String(req.query.output_format || process.env.DEFAULT_OUTPUT_FORMAT || "mp3_44100_128");
            const apiKey = process.env.ELEVENLABS_API_KEY;
            if (!apiKey)
                return res.status(500).json({ error: "ELEVENLABS_API_KEY not set" });
            // פרמטרים מומלצים לסטרימינג
            const qs = new URLSearchParams({
                optimize_streaming_latency: "0",
                output_format,
            });
            const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?${qs.toString()}`;
            const body = {
                text,
                model_id: model, // <-- חשוב: model_id
                voice_settings: {
                    stability: 1,
                    similarity_boost: 1,
                    style: 0,
                    use_speaker_boost: true,
                    speed,
                },
                language_code: "he"
            };
            const upstream = await fetch(url, {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "content-type": "application/json",
                    "accept": "audio/mpeg",
                },
                body: JSON.stringify(body),
            });
            if (!upstream.ok || !upstream.body) {
                const msg = await upstream.text().catch(() => upstream.statusText);
                return res.status(502).json({ error: "elevenlabs upstream error", status: upstream.status, msg });
            }
            res.setHeader("Content-Type", output_format.startsWith("mp3") ? "audio/mpeg" : "audio/*");
            res.setHeader("Cache-Control", "no-store");
            Readable.fromWeb(upstream.body).pipe(res);
        }
        catch (err) {
            console.error("TTS error:", err);
            res.status(500).json({ error: "internal", message: err?.message || String(err) });
        }
    });
    return app;
}
