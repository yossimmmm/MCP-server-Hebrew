import { spawn } from "child_process";
import WebSocket from "ws";
import { Readable } from "node:stream";

export async function speakTextToTwilio(
  ws: WebSocket,
  streamSid: string,
  text: string,
  voiceId?: string
): Promise<void> {
  if (!streamSid) throw new Error("Missing streamSid for outbound audio");

  const PORT = Number(process.env.PORT || 8080);
  const localBase = `http://127.0.0.1:${PORT}`;

  const url = new URL("/stream/tts", localBase);
  url.searchParams.set("text", text);
  url.searchParams.set("output_format", "mp3_44100_128");
  if (voiceId) url.searchParams.set("voice_id", voiceId);
  url.searchParams.set("model", process.env.DEFAULT_MODEL || "eleven_v3");

  const res = await fetch(url.toString());
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS HTTP ${res.status} ${body}`);
  }

  const ff = spawn("ffmpeg", [
    "-hide_banner","-loglevel","error",
    "-i","pipe:0",
    "-acodec","pcm_mulaw","-ar","8000","-ac","1",
    "-f","mulaw","pipe:1",
  ]);

  ff.on("error", (e) => console.error("[ffmpeg spawn error]", e));
  ff.stdin.on("error", (e) => console.error("[ffmpeg stdin error]", e));
  Readable.fromWeb(res.body as any).pipe(ff.stdin);

  // קצבן 20ms → 160 בייט לפריים
  let carry: Buffer = Buffer.alloc(0);
  const queue: Buffer[] = [];
  let seq = 0;
  let pacer: NodeJS.Timeout | null = null;

  const startPacer = () => {
    if (pacer) return;
    pacer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) { clearInterval(pacer!); pacer = null; return; }
      const frame = queue.shift();
      if (!frame) return;
      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        sequenceNumber: String(++seq),
        media: { payload: frame.toString("base64") },
      }));
    }, 20);
  };

  ff.stdout.on("data", (chunk: Buffer) => {
    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let off = 0;
    while (off + 160 <= data.length) {
      queue.push(data.subarray(off, off + 160));
      off += 160;
    }
    carry = off < data.length ? data.subarray(off) : Buffer.alloc(0);
    startPacer();
  });

  await new Promise<void>((resolve) => {
    ff.once("close", () => {
      const drain = setInterval(() => {
        if (queue.length === 0) { clearInterval(drain); if (pacer) { clearInterval(pacer); pacer = null; } resolve(); }
      }, 50);
    });
  });
}
