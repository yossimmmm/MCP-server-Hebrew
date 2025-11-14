// scripts/preRenderWaitingPhrases.ts
import fs from "fs/promises";
import path from "path";
import { WAITING_PHRASES } from "../src/nlu/waitingPhrases.js";

const XI_API = process.env.XI_API_BASE ?? "https://api.elevenlabs.io/v1";

async function renderOne(id: string, text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set");
  }

  const qs = new URLSearchParams({ output_format: "ulaw_8000" });
  const url = `${XI_API}/text-to-speech/${encodeURIComponent(
    voiceId
  )}/stream?${qs.toString()}`;

  const body = {
    text,
    model_id: process.env.DEFAULT_MODEL || "eleven_v3",
    language_code: "he",
  };

  console.log("[PRE-RENDER] TTS", id, "→", url);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "*/*",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`TTS failed for ${id}: ${res.status} ${msg}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const outDir = path.join(process.cwd(), "media", "waiting");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${id}.ulaw`);

  await fs.writeFile(outPath, buf);
  console.log("[PRE-RENDER] saved", outPath, "bytes:", buf.length);
}

async function main() {
  for (const p of WAITING_PHRASES) {
    await renderOne(p.id, p.text);
  }
  console.log("✅ Done pre-rendering all waiting phrases.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
