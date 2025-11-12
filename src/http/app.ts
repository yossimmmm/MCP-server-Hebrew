// src/http/app.ts  (רק הראוט /stream/tts)
import express from "express";
import cors from "cors";
import { Readable } from "node:stream";
const XI_API = "https://api.elevenlabs.io/v1";

export function createHttpApp() {
  const app = express();
  app.use(cors({ origin: "*", maxAge: 600 }));

  app.get("/stream/tts", async (req, res) => {
    try {
      const text = String(req.query.text || "");
      if (!text.trim()) return res.status(400).json({ error: "missing text" });

      const apiKey  = process.env.ELEVENLABS_API_KEY || "";
      if (!apiKey) return res.status(500).json({ error: "ELEVENLABS_API_KEY not set" });

      const voiceId = String(req.query.voice_id || process.env.ELEVENLABS_VOICE_ID || "");
      if (!voiceId) return res.status(400).json({ error: "voice_id required" });

      const model   = String(req.query.model || process.env.DEFAULT_MODEL || "eleven_v3");
      const format  = String(req.query.output_format || process.env.DEFAULT_OUTPUT_FORMAT || "mp3_44100_128");

      const qs = new URLSearchParams({ output_format: format, optimize_streaming_latency: "4" });
      const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?${qs.toString()}`;

      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          "accept": "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: model }),
      });

      if (!upstream.ok || !upstream.body) {
        const body = await upstream.text().catch(() => "");
        return res.status(upstream.status || 502).json({
          upstream_status: upstream.status,
          model_tried: model,
          voice_id: voiceId,
          detail: body || "upstream error (empty body)"
        });
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "no-store");
      Readable.fromWeb(upstream.body as any).pipe(res);

    } catch (err: any) {
      console.error("TTS error:", err);
      res.status(500).json({ error: "internal", message: err?.message || String(err) });
    }
  });

  return app;
}
export default createHttpApp;
