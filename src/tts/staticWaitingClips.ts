// src/tts/staticWaitingClips.ts
import fs from "fs";
import path from "path";
import WebSocket from "ws";

const FRAME_BYTES = 160; // 20ms @ 8kHz μ-law

type Clip = {
  id: string;
  frames: Buffer[];
};

const clips = new Map<string, Clip>();
let loaded = false;

function loadOnce() {
  if (loaded) return;
  loaded = true;

  const dir = path.join(process.cwd(), "media", "waiting");
  if (!fs.existsSync(dir)) {
    console.warn("[waitingClips] directory not found:", dir);
    return;
  }

  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith(".ulaw")) continue;
    const id = path.basename(f, ".ulaw");
    const full = path.join(dir, f);
    const buf = fs.readFileSync(full);

    const frames: Buffer[] = [];
    for (let off = 0; off < buf.length; off += FRAME_BYTES) {
      frames.push(buf.subarray(off, off + FRAME_BYTES));
    }

    clips.set(id, { id, frames });
  }

  console.log("[waitingClips] loaded", clips.size, "clips from", dir);
}

export function getWaitingClipIds(): string[] {
  loadOnce();
  return [...clips.keys()];
}

export async function playWaitingClip(
  ws: WebSocket,
  streamSid: string,
  id: string,
  seqRef: { value: number },
  signal?: AbortSignal
): Promise<"ok" | "canceled"> {
  loadOnce();
  const clip = clips.get(id);
  if (!clip) {
    console.warn("[waitingClips] missing clip", id);
    return "ok";
  }

  const pacerMs = Number(process.env.TTS_PACER_MS || "20");
  let canceled = false;

  const onAbort = () => {
    canceled = true;
  };

  if (signal) {
    if (signal.aborted) return "canceled";
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    for (const frame of clip.frames) {
      if (canceled) break;
      if (ws.readyState !== WebSocket.OPEN) break;

      ws.send(
        JSON.stringify({
          event: "media",
          streamSid,
          sequenceNumber: String(++seqRef.value),
          media: { payload: frame.toString("base64") },
        })
      );

      if (pacerMs > 0) {
        await new Promise((r) => setTimeout(r, pacerMs));
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }

  return canceled ? "canceled" : "ok";
}
