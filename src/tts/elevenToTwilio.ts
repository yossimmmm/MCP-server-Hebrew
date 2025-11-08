import { spawn } from "child_process";
import WebSocket from "ws";

export async function speakTextToTwilio(
  ws: WebSocket,
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

  // לרוקן תור נגן
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: "clear", streamSid, track: "outbound" }));
  }

  const ff = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", "pipe:0",
    "-acodec", "pcm_mulaw",
    "-ar", "8000",
    "-ac", "1",
    "-f", "mulaw",
    "pipe:1",
  ]);

  // במקרה ואין ffmpeg תקין, תראה שגיאה ברורה
  ff.stderr.on("data", d => console.error("[ffmpeg]", d.toString()));

  // @ts-ignore
  res.body.pipe(ff.stdin);

  ff.stdout.on("data", (chunk: Buffer) => {
    for (let i = 0; i + 160 <= chunk.length; i += 160) {
      const frame = chunk.subarray(i, i + 160);
      if (ws.readyState !== WebSocket.OPEN) break;
      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        track: "outbound",                 // <<< חשוב
        media: { payload: frame.toString("base64") }
      }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    ff.once("close", () => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "mark", streamSid, track: "outbound", mark: { name: "tts_end" } }));
        }
      } catch {}
      resolve();
    });
    ff.once("error", reject);
  });
}
