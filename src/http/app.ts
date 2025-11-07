import express from "express";
import cors from "cors";
import { Readable } from "node:stream";

const XI_API = "https://api.elevenlabs.io/v1";

export function createHttpApp() {
  const app = express();

  app.use(cors({ origin: "*", maxAge: 600 }));
  app.use(express.json({ limit: "1mb" }));

  // Health
  app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

  /**
   * GET /stream/tts
   * Proxies ElevenLabs TTS v3 streaming (HTTP chunked) and pipes to the client.
   * Query: text (required), voice_id?, speed?, model?, output_format?
   */
  app.get("/stream/tts", async (req, res) => {
    try {
      const text = String(req.query.text || "");
      if (!text.trim()) {
        res.status(400).json({ error: "Missing 'text' query param" });
        return;
      }

      const voiceId =
        (req.query.voice_id as string) || process.env.ELEVENLABS_VOICE_ID!;
      const model = (req.query.model as string) || process.env.DEFAULT_MODEL || "eleven_v3";
      const speed =
        req.query.speed !== undefined ? Number(req.query.speed) : 1.0;
      const output_format =
        (req.query.output_format as string) ||
        process.env.DEFAULT_OUTPUT_FORMAT ||
        "mp3_44100_128";

      // v3: stream over HTTP (not WebSocket) — per docs
      // POST /v1/text-to-speech/{voice_id}/stream
      const upstream = await fetch(`${XI_API}/text-to-speech/${voiceId}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY!,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          text,
          output_format,
          language_code: "he",
          voice_settings: {
            stability: 1,
            similarity_boost: 1,
            style: 0,
            use_speaker_boost: true,
            speed
          }
        })
      });

      if (!upstream.ok || !upstream.body) {
        const msg = await upstream.text().catch(() => upstream.statusText);
        res.status(upstream.status).end(msg);
        return;
      }

      // Set progressive/streaming headers
      res.setHeader("Content-Type", output_format.startsWith("mp3") ? "audio/mpeg" : "audio/*");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Transfer-Encoding", "chunked");

      // Pipe the web ReadableStream to Node response
      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "stream failed" });
    }
  });

  return app;
}
