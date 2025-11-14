// src/http/app.ts
import express, { Request, Response } from "express";
import cors from "cors";
import { Readable } from "node:stream";
import { attachWidgetRoutes } from "../widget/widgetRoutes.js"; // ⬅️ NEW

const XI_API = process.env.XI_API_BASE ?? "https://api.elevenlabs.io/v1";

type TtsQuery = {
  text?: string;
  voice_id?: string;
  model?: string;
  output_format?: string;
  language_code?: string;
  voice_settings?: string;
  optimize_streaming_latency?: string | number | boolean;
};

function parseVoiceSettings(input?: string) {
  if (!input) return undefined;
  try {
    const v = JSON.parse(input);
    return v;
  } catch {
    return undefined;
  }
}

export function createHttpApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: "*", maxAge: 600 }));

  // ⬅️ allow JSON bodies for widget API
  app.use(express.json({ limit: "1mb" }));

  // health
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

  // === existing TTS stream endpoint (unchanged, just kept as-is) ===
  app.get(
    "/stream/tts",
    async (
      req: Request<unknown, unknown, unknown, TtsQuery>,
      res: Response
    ) => {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "ELEVENLABS_API_KEY not set" });
      }

      const text = String(req.query.text ?? "").trim();
      if (!text) {
        return res.status(400).json({ error: "Missing 'text' query param" });
      }

      const voiceId = String(
        req.query.voice_id ?? process.env.ELEVENLABS_VOICE_ID ?? ""
      );
      if (!voiceId) {
        return res.status(400).json({
          error: "voice_id required (or set ELEVENLABS_VOICE_ID)",
        });
      }

      const model = String(
        req.query.model ?? process.env.DEFAULT_MODEL ?? "eleven_v3"
      );

      // Telephony default stays ulaw_8000,
      // widget will override with output_format=opus_48000_128 or pcm_48000
      const output_format = String(
        req.query.output_format ??
          process.env.DEFAULT_OUTPUT_FORMAT ??
          "ulaw_8000"
      );

      const language_code = String(req.query.language_code ?? "he");
      const voice_settings = parseVoiceSettings(req.query.voice_settings);

      const qs = new URLSearchParams({ output_format });

      const optLat =
        req.query.optimize_streaming_latency ??
        process.env.OPTIMIZE_STREAMING_LATENCY;
      if (!model.startsWith("eleven_v3") && optLat != null) {
        qs.set("optimize_streaming_latency", String(optLat));
      }

      const url = `${XI_API}/text-to-speech/${encodeURIComponent(
        voiceId
      )}/stream?${qs.toString()}`;
      const body: Record<string, unknown> = {
        text,
        model_id: model,
        language_code,
        ...(voice_settings ? { voice_settings } : {}),
      };

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
            accept: "*/*",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        const ct = upstream.headers.get("content-type") ?? "";
        console.log(
          "[TTS upstream] status=%s content-type=%s",
          upstream.status,
          ct
        );

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

        res.setHeader("Content-Type", ct || "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const nodeReadable = Readable.fromWeb(upstream.body as any);
        nodeReadable.on("error", (e) => {
          console.error("[TTS pipe] error:", e);
          try {
            res.destroy(e as Error);
          } catch {}
        });
        nodeReadable.pipe(res);
      } catch (err: any) {
        if (err?.name === "AbortError") {
          console.warn("[TTS upstream] aborted by client");
          return;
        }
        console.error("TTS error:", err);
        res
          .status(500)
          .json({ error: "internal", message: err?.message ?? String(err) });
      } finally {
        (req as any).off?.("close", abortUpstream);
        (req as any).off?.("aborted", abortUpstream);
      }
    }
  );

  // ⬅️ attach the widget API + JS
  attachWidgetRoutes(app);

  return app;
}

export default createHttpApp;
