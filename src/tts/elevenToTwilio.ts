import { spawn } from "child_process";
import WebSocket from "ws";

export async function speakTextToTwilio(
  ws: WebSocket,
  streamSid: string,
  text: string,
  voiceId?: string
) {
  const base = process.env.PUBLIC_BASE_URL!;
  const url = new URL("/stream/tts", base);
  url.searchParams.set("text", text);
  url.searchParams.set("output_format", "mp3_44100_128");
  if (voiceId) url.searchParams.set("voice_id", voiceId);

  const res = await fetch(url.toString());
  if (!res.ok || !res.body) throw new Error("TTS HTTP " + res.status);

  const ff = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", "pipe:0",
    "-acodec", "pcm_mulaw",
    "-ar", "8000",
    "-ac", "1",
    "-f", "mulaw",
    "pipe:1",
  ]);

  ff.on("error", (e) => console.error("[ffmpeg spawn error]", e));
  ff.stderr.on("data", d => console.error("[ffmpeg]", d.toString()));

  // @ts-ignore (ReadableStream to Node stream)
  res.body.pipe(ff.stdin);

  let outFrames = 0;

  ff.stdout.on("data", (chunk: Buffer) => {
    // 20ms per frame at 8k μ-law → 160 bytes
    for (let i = 0; i + 160 <= chunk.length; i += 160) {
      const frame = chunk.subarray(i, i + 160);
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        track: "outbound",
        media: { payload: frame.toString("base64") }
      }));
      outFrames++;
    }
  });

  await new Promise<void>((resolve, reject) => {
    ff.once("close", () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            event: "mark",
            streamSid,
            track: "outbound",
            mark: { name: "tts_end" }
          }));
        }
      } catch {}
      console.log("[ffmpeg] closed. frames sent:", outFrames);
      resolve();
    });
    ff.once("error", reject);
  });
}
