// scripts/preRenderWaitingPhrases.ts
import fs from "fs/promises";
import path from "path";
import { WAITING_PHRASES } from "../nlu/waitingPhrases.js";

const XI_API = process.env.XI_API_BASE ?? "https://api.elevenlabs.io/v1";

// אפשר לשלוט בפורמט וקובץ היציאה דרך env
const OUTPUT_FORMAT = process.env.WAITING_OUTPUT_FORMAT || "ulaw_8000";
const OUT_DIR = process.env.WAITING_OUT_DIR || "media/waiting";
const OUT_EXT = process.env.WAITING_OUT_EXT || ".ulaw";

function stripLeadingTag(text: string): string {
  // remove leading [tag] if exists, keep the Hebrew phrase clean
  return text.replace(/^\s*\[[^\]]+\]\s*/, "").trim();
}

async function renderOne(id: string, text: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set");
  }

  const qs = new URLSearchParams({ output_format: OUTPUT_FORMAT });
  const url = `${XI_API}/text-to-speech/${encodeURIComponent(
    voiceId
  )}/stream?${qs.toString()}`;

  const spokenText = stripLeadingTag(text);

  const body = {
    text: spokenText,
    model_id: process.env.DEFAULT_MODEL || "eleven_v3",
    language_code: "he",
  };

  console.log("[PRE-RENDER] TTS", id, "→", url, "format:", OUTPUT_FORMAT);
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
  const outDir = path.join(process.cwd(), OUT_DIR);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${id}${OUT_EXT}`);

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
