// src/http/app.ts
import express from "express";
import cors from "cors";
import { Readable } from "node:stream";
const XI_API = process.env.XI_API_BASE ?? "https://api.elevenlabs.io/v1";
function parseVoiceSettings(input) {
    if (!input)
        return undefined;
    try {
        const v = JSON.parse(input);
        return v;
    }
    catch {
        return undefined;
    }
}
export function createHttpApp() {
    const app = express();
    app.disable("x-powered-by");
    app.use(cors({ origin: "*", maxAge: 600 }));
    app.get("/health", (_req, res) => res.status(200).json({ ok: true }));
    app.get("/stream/tts", async (req, res) => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "ELEVENLABS_API_KEY not set" });
        }
        const text = String(req.query.text ?? "").trim();
        if (!text) {
            return res.status(400).json({ error: "Missing 'text' query param" });
        }
        const voiceId = String(req.query.voice_id ?? process.env.ELEVENLABS_VOICE_ID ?? "");
        if (!voiceId) {
            return res.status(400).json({
                error: "voice_id required (or set ELEVENLABS_VOICE_ID)",
            });
        }
        const model = String(req.query.model ?? process.env.DEFAULT_MODEL ?? "eleven_v3");
        // Telephony-safe default
        const output_format = String(req.query.output_format ??
            process.env.DEFAULT_OUTPUT_FORMAT ??
            "ulaw_8000");
        // ElevenLabs expects "he" for Hebrew
        const language_code = String(req.query.language_code ?? "he");
        const voice_settings = parseVoiceSettings(req.query.voice_settings);
        const qs = new URLSearchParams({ output_format });
        // Don't set optimize_streaming_latency for v3
        const optLat = req.query.optimize_streaming_latency ??
            process.env.OPTIMIZE_STREAMING_LATENCY;
        if (!model.startsWith("eleven_v3") && optLat != null) {
            qs.set("optimize_streaming_latency", String(optLat));
        }
        const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?${qs.toString()}`;
        const body = {
            text,
            model_id: model,
            language_code,
            ...(voice_settings ? { voice_settings } : {}),
        };
        // Abort upstream if client disconnects
        const controller = new AbortController();
        const abortUpstream = () => controller.abort();
        req.on("close", abortUpstream);
        req.on("aborted", abortUpstream);
        try {
            console.log("[TTS upstream] POST", url, "model:", model);
            const upstream = await fetch(url, {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "content-type": "application/json",
                    accept: "*/*", // ulaw/pcm/mp3
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            const ct = upstream.headers.get("content-type") ?? "";
            console.log("[TTS upstream] status=%s content-type=%s", upstream.status, ct);
            if (!upstream.ok || !upstream.body) {
                const msg = await upstream.text().catch(() => upstream.statusText);
                console.error("[TTS upstream] ERROR %s: %s", upstream.status, msg);
                return res.status(502).json({
                    error: "elevenlabs upstream error",
                    upstream_status: upstream.status,
                    model_tried: model,
                    voice_id: voiceId,
                    msg,
                });
            }
            // Stream pass-through
            res.setHeader("Content-Type", ct || "application/octet-stream");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Accel-Buffering", "no"); // disable buffering (nginx)
            res.setHeader("Connection", "keep-alive");
            res.flushHeaders?.();
            const nodeReadable = Readable.fromWeb(upstream.body);
            nodeReadable.on("error", (e) => {
                console.error("[TTS pipe] error:", e);
                try {
                    res.destroy(e);
                }
                catch { }
            });
            nodeReadable.pipe(res);
        }
        catch (err) {
            if (err?.name === "AbortError") {
                console.warn("[TTS upstream] aborted by client");
                return;
            }
            console.error("TTS error:", err);
            res
                .status(500)
                .json({ error: "internal", message: err?.message ?? String(err) });
        }
        finally {
            req.off?.("close", abortUpstream);
            req.off?.("aborted", abortUpstream);
        }
    });
    return app;
}
export default createHttpApp;
