// src/tts/staticWaitingClips.ts
import fs from "fs";
import path from "path";
import WebSocket from "ws";
const FRAME_BYTES = 160; // 20ms @ 8kHz μ-law
const CLIPS_DIR = process.env.WAITING_CLIPS_DIR ||
    path.join(process.cwd(), "media", "waiting");
const clips = new Map();
let loaded = false;
function loadOnce() {
    if (loaded)
        return;
    loaded = true;
    try {
        if (!fs.existsSync(CLIPS_DIR)) {
            console.warn("[waitingClips] directory not found:", CLIPS_DIR);
            return;
        }
        const files = fs.readdirSync(CLIPS_DIR);
        for (const f of files) {
            if (!f.toLowerCase().endsWith(".ulaw"))
                continue;
            const id = path.basename(f, ".ulaw");
            const full = path.join(CLIPS_DIR, f);
            const buf = fs.readFileSync(full);
            const frames = [];
            for (let off = 0; off < buf.length; off += FRAME_BYTES) {
                const remaining = buf.length - off;
                if (remaining >= FRAME_BYTES) {
                    // פריים מלא
                    frames.push(buf.subarray(off, off + FRAME_BYTES));
                }
                else {
                    // פריים אחרון חלקי → מרפדים בשקט μ-law (0xff)
                    const padded = Buffer.alloc(FRAME_BYTES, 0xff);
                    buf.copy(padded, 0, off, off + remaining);
                    frames.push(padded);
                }
            }
            clips.set(id, { id, frames });
        }
        console.log("[waitingClips] loaded", clips.size, "clips from", CLIPS_DIR);
    }
    catch (err) {
        console.error("[waitingClips] error while loading clips:", err?.message || err);
    }
}
export function getWaitingClipIds() {
    loadOnce();
    return [...clips.keys()];
}
export async function playWaitingClip(ws, streamSid, id, seqRef, signal) {
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
        if (signal.aborted) {
            return "canceled";
        }
        signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
        for (const frame of clip.frames) {
            if (canceled)
                break;
            if (ws.readyState !== WebSocket.OPEN)
                break;
            ws.send(JSON.stringify({
                event: "media",
                streamSid,
                sequenceNumber: String(++seqRef.value),
                media: { payload: frame.toString("base64") },
            }));
            if (pacerMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, pacerMs));
            }
        }
    }
    catch (err) {
        console.error("[waitingClips] error while streaming clip", id, ":", err?.message || err);
    }
    finally {
        if (signal) {
            signal.removeEventListener("abort", onAbort);
        }
    }
    return canceled ? "canceled" : "ok";
}
