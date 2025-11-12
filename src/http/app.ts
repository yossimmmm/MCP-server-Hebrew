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

      const voiceId =
        (req.query.voice_id as string) ||
        process.env.ELEVENLABS_VOICE_ID ||
        "";
      if (!voiceId) {
        return res
          .status(400)
          .json({ error: "voice_id required (or set ELEVENLABS_VOICE_ID)" });
      }

      const model = String(
        req.query.model || process.env.DEFAULT_MODEL || "eleven_v3"
      );

      const output_format = String(
        req.query.output_format ||
          process.env.DEFAULT_OUTPUT_FORMAT ||
          "ulaw_8000" // ← default for phone
      );

      const language_code = String(req.query.language_code || "he");

      // Optional per-request voice tuning
      const voice_settings = req.query.voice_settings
        ? JSON.parse(String(req.query.voice_settings))
        : undefined;

      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "ELEVENLABS_API_KEY not set" });
      }

      const qs = new URLSearchParams();
      qs.set("output_format", output_format);

      // Don't set optimize_streaming_latency for v3
      const optLat =
        req.query.optimize_streaming_latency ??
        process.env.OPTIMIZE_STREAMING_LATENCY;
      if (!model.startsWith("eleven_v3") && optLat != null) {
        qs.set("optimize_streaming_latency", String(optLat));
      }

      const url = `${XI_API}/text-to-speech/${encodeURIComponent(
        voiceId
      )}/stream?${qs.toString()}`;

      console.log("[TTS upstream] POST", url, "model:", model);

      const body: Record<string, any> = {
        text,
        model_id: model,
        language_code,
      };
      if (voice_settings) body.voice_settings = voice_settings;

      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
          accept: "*/*", // allow ulaw/pcm/mp3
        },
        body: JSON.stringify(body),
      });

      const ct = upstream.headers.get("content-type") || "";
      console.log(
        `[TTS upstream] status=${upstream.status} content-type=${ct}`
      );

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

      // Pass-through regardless of content-type
      res.setHeader("Content-Type", ct || "application/octet-stream");
      res.setHeader("Cache-Control", "no-store");
      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err: any) {
      console.error("TTS error:", err);
      res
        .status(500)
        .json({ error: "internal", message: err?.message || String(err) });
    }
  });

  return app;
}

export default createHttpApp;