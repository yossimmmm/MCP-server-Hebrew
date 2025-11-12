// src/tts/elevenToTwilio.ts
import WebSocket from "ws";
import { performance } from "node:perf_hooks";
const XI_API = "https://api.elevenlabs.io/v1";
function nextTick(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
/**
 * Streams Hebrew TTS as μ-law 8kHz directly from ElevenLabs and feeds Twilio as 20ms frames (160 bytes).
 * Supports barge-in via AbortSignal.
 */
export async function speakTextToTwilio(ws, streamSid, text, opts = {}) {
    if (!streamSid)
        throw new Error("Missing streamSid");
    const { voiceId = process.env.ELEVENLABS_VOICE_ID || "", modelId = process.env.DEFAULT_MODEL || "eleven_v3", startBufferFrames = 12, pacerMs = 20, signal, voiceSettings, language_code = "he", } = opts;
    if (!voiceId)
        throw new Error("voiceId required (set ELEVENLABS_VOICE_ID)");
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey)
        throw new Error("ELEVENLABS_API_KEY not set");
    // Build ElevenLabs streaming URL for μ-law at 8kHz (telephony-native)
    const qs = new URLSearchParams();
    qs.set("output_format", "ulaw_8000"); // native Twilio format
    const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?${qs.toString()}`;
    // Prepare request body
    const body = {
        text,
        model_id: modelId,
        language_code,
    };
    if (voiceSettings)
        body.voice_settings = voiceSettings;
    console.log(`[TTS] POST XI stream ulaw_8000 model=${modelId} voice=${voiceId} text=***`);
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) {
        if (signal.aborted)
            return "canceled";
        signal.addEventListener("abort", onAbort, { once: true });
    }
    let canceled = false;
    const cleanupAbort = () => {
        if (signal)
            signal.removeEventListener("abort", onAbort);
    };
    let res = null;
    try {
        res = await fetch(url, {
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "content-type": "application/json",
                accept: "*/*",
            },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
    }
    catch (e) {
        cleanupAbort();
        if (e?.name === "AbortError")
            return "canceled";
        throw e;
    }
    const ct = res.headers.get("content-type") || "";
    console.log(`[TTS upstream] status=${res.status} ct=${ct}`);
    if (!res.ok || !res.body) {
        cleanupAbort();
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`ElevenLabs upstream error ${res.status}: ${msg}`);
    }
    // Jitter buffer: gather 160-byte μ-law frames
    const queue = [];
    let carry = Buffer.alloc(0); // IMPORTANT: no generic annotation
    let seq = 0;
    let sentFrames = 0;
    // Start pacer when we have a little buffer
    let pacing = false;
    let pacerTimer;
    let t0 = performance.now();
    let tick = 0;
    const startPacer = () => {
        if (pacing)
            return;
        pacing = true;
        const step = () => {
            if (ws.readyState !== WebSocket.OPEN)
                return;
            if (canceled)
                return;
            const due = t0 + (++tick) * pacerMs;
            const now = performance.now();
            const frame = queue.length ? queue.shift() : Buffer.alloc(160, 0xff); // μ-law silence
            ws.send(JSON.stringify({
                event: "media",
                streamSid,
                sequenceNumber: String(++seq),
                media: { payload: frame.toString("base64") },
            }));
            sentFrames++;
            const delay = Math.max(0, due - now);
            pacerTimer = setTimeout(step, delay);
        };
        pacerTimer = setTimeout(step, pacerMs);
    };
    // Stream reader → frames
    (async () => {
        try {
            const maybeReader = res.body;
            const reader = typeof maybeReader?.getReader === "function" ? maybeReader.getReader() : null;
            if (reader) {
                while (true) {
                    if (ctrl.signal.aborted)
                        break;
                    const { value, done } = await reader.read();
                    if (done)
                        break;
                    if (!value?.length)
                        continue;
                    const chunk = Buffer.from(value);
                    const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
                    let off = 0;
                    while (off + 160 <= data.length) {
                        queue.push(data.subarray(off, off + 160));
                        off += 160;
                    }
                    carry = off < data.length ? data.subarray(off) : Buffer.alloc(0);
                    if (!pacing && queue.length >= startBufferFrames)
                        startPacer();
                }
            }
            else {
                // Fallback for older runtimes: Node Readable
                for await (const chunk of res.body) {
                    const b = Buffer.from(chunk);
                    const data = carry.length ? Buffer.concat([carry, b]) : b;
                    let off = 0;
                    while (off + 160 <= data.length) {
                        queue.push(data.subarray(off, off + 160));
                        off += 160;
                    }
                    carry = off < data.length ? data.subarray(off) : Buffer.alloc(0);
                    if (!pacing && queue.length >= startBufferFrames)
                        startPacer();
                }
            }
        }
        catch (e) {
            if (e?.name === "AbortError") {
                canceled = true;
            }
            else {
                console.error("[TTS stream read error]", e?.message || e);
            }
        }
    })();
    // Wait for queue drain or cancel
    try {
        while (!ctrl.signal.aborted) {
            if (!pacing && queue.length > 0)
                startPacer();
            if (pacing && queue.length === 0 && res.body) {
                await nextTick(pacerMs * 2);
                if (queue.length === 0)
                    break;
            }
            await nextTick(10);
        }
    }
    finally {
        cleanupAbort();
        if (pacerTimer)
            clearTimeout(pacerTimer);
        try {
            if (ws.readyState === WebSocket.OPEN && !canceled) {
                ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "tts_end" } }));
            }
        }
        catch { }
        console.log(`[TTS] frames sent: ${sentFrames} (canceled=${ctrl.signal.aborted})`);
    }
    return ctrl.signal.aborted ? "canceled" : "ok";
}
export default speakTextToTwilio;
