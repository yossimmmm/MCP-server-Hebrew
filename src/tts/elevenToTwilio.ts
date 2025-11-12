// src/tts/elevenToTwilio.ts
import { spawn } from "child_process";
import WebSocket from "ws";
import { Readable } from "node:stream";

/**
 * ממיר טקסט לאודיו דרך /stream/tts, משנמך ל-μ-law 8kHz מונו,
 * ושולח ל-Twilio בפריימים של 160 בייט (20ms).
 */
export async function speakTextToTwilio(
  ws: WebSocket,
  streamSid: string,
  text: string,
  voiceId?: string
): Promise<void> {
  if (!streamSid) throw new Error("Missing streamSid");

  // נשתמש בלופבאק מקומי כדי לא להיתקע על PUBLIC_BASE_URL פנימי/חיצוני
  const PORT = Number(process.env.PORT || 8080);
  const localBase = `http://127.0.0.1:${PORT}`;

  const url = new URL("/stream/tts", localBase);
  url.searchParams.set("text", text);
  url.searchParams.set("output_format", "mp3_44100_128");
  url.searchParams.set("model", process.env.DEFAULT_MODEL || "eleven_v3");
  if (voiceId) url.searchParams.set("voice_id", voiceId);

  // לוג דיבאג בלי לחשוף טקסט:
  console.log(
    `[TTS] → ${url.toString().replace(/text=[^&]*/,'text=***')} model:${process.env.DEFAULT_MODEL || "eleven_v3"}`
  );

  const res = await fetch(url.toString());
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS HTTP ${res.status} ${body}`);
  }

  // mp3 → μ-law 8kHz mono raw
  const ff = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel", "error",
    "-i", "pipe:0",
    "-acodec", "pcm_mulaw",
    "-ar", "8000",
    "-ac", "1",
    "-f", "mulaw",
    "pipe:1",
  ]);

  ff.on("error", (e) => console.error("[ffmpeg spawn error]", e));
  ff.stdin.on("error", (e) => console.error("[ffmpeg stdin error]", e));
  ff.stderr.on("data", (d) => console.error("[ffmpeg]", d.toString()));

  // חיבור הזרם הנכנס מ-/stream/tts ל-ffmpeg
  Readable.fromWeb(res.body as any).pipe(ff.stdin);

  // תור פריימים ל־20ms pace
  const queue: Buffer[] = [];
  let carry: Buffer = Buffer.alloc(0); // ← בלי Generic! רק Buffer
  let seq = 0;
  let sentFrames = 0;
  const MAX_QUEUE = 500; // הגבלת זיכרון סבירה

  // שקט פתיחה 1s (50 פריימים של 0xFF)
  for (let i = 0; i < 50; i++) queue.push(Buffer.alloc(160, 0xFF));

  // pace של 20ms
  const pacer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const frame = queue.shift();
    if (!frame) return;

    ws.send(JSON.stringify({
      event: "media",
      streamSid,
      sequenceNumber: String(++seq),
      media: { payload: frame.toString("base64") },
    }));

    if ((++sentFrames % 100) === 0) {
      console.log(`[TTS→Twilio] sent ${sentFrames} frames`);
    }
  }, 20);

  // אם ה-WS נסגר באמצע → ננקה משאבים
  const onWsCloseOrError = () => {
    try { clearInterval(pacer); } catch {}
    try { ff.kill("SIGKILL"); } catch {}
  };
  ws.once("close", onWsCloseOrError);
  ws.once("error", onWsCloseOrError);

  // מילוי התור מתוך הפלט הגולמי של ffmpeg
  ff.stdout.on("data", (chunk: Buffer) => {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let off = 0;

    while (off + 160 <= data.length) {
      if (queue.length < MAX_QUEUE) {
        queue.push(data.subarray(off, off + 160));
      }
      off += 160;
    }
    carry = off < data.length ? data.subarray(off) : Buffer.alloc(0);
  });

  // סגירה מסודרת: לרוקן תור, לסמן סוף, ולנקות מאזינים
  await new Promise<void>((resolve) => {
    ff.once("close", () => {
      const drain = setInterval(() => {
        if (queue.length === 0) {
          clearInterval(drain);
          clearInterval(pacer);
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "tts_end" } }));
            }
          } catch {}
          ws.off("close", onWsCloseOrError);
          ws.off("error", onWsCloseOrError);
          console.log(`[ffmpeg] closed. frames sent total: ${sentFrames}`);
          resolve();
        }
      }, 50);
    });
  });
}
