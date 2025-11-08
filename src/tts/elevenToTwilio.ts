// src/telephony/elevenToTwilio.ts
import { spawn } from "child_process";

export async function speakTextToTwilio(
  ws: any,
  streamSid: string,
  text: string,
  voiceId?: string
) {
  const base = process.env.PUBLIC_BASE_URL!;
  const url = new URL(base + "/stream/tts");
  url.searchParams.set("text", text);
  url.searchParams.set("output_format", "mp3_44100_128");
  if (voiceId) url.searchParams.set("voice_id", voiceId);

  const res = await fetch(url.toString());
  if (!res.ok || !res.body) throw new Error("TTS HTTP " + res.status);

  // clear any pending audio on the call
  ws.send(JSON.stringify({ event: "clear", streamSid }));

  const ff = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", "pipe:0",
    "-acodec", "pcm_mulaw",
    "-ar", "8000",
    "-ac", "1",
    "-f", "mulaw",
    "pipe:1",
  ]);

  // @ts-ignore Node ReadableStream piping
  res.body.pipe(ff.stdin);

  ff.stdout.on("data", (chunk: Buffer) => {
    for (let i = 0; i + 160 <= chunk.length; i += 160) {
      const frame = chunk.subarray(i, i + 160);
      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: { payload: frame.toString("base64") }
      }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    ff.once("close", () => {
      try { ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "tts_end" } })); } catch {}
      resolve();
    });
    ff.once("error", reject);
  });
}
