import WebSocket from "ws";
import { performance } from "node:perf_hooks";
import { Buffer } from "node:buffer";
const XI_API = process.env.XI_API_BASE ?? "https://api.elevenlabs.io/v1";
const FRAME_BYTES = 160; // 20ms of μ-law @ 8kHz
// μ-law silence frame (0xFF)
const ULawSilenceU8 = new Uint8Array(FRAME_BYTES);
ULawSilenceU8.fill(0xff);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toB64 = (u8) => Buffer.from(u8).toString("base64");
function concatU8(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
}
/**
 * Streams μ-law 8kHz audio from ElevenLabs and feeds Twilio as 20ms frames.
 */
export async function speakTextToTwilio(ws, streamSid, text, opts = {}) {
    if (!streamSid)
        throw new Error("Missing streamSid");
    const { voiceId = process.env.ELEVENLABS_VOICE_ID || "", modelId = process.env.DEFAULT_MODEL || "eleven_v3", startBufferFrames = Number(process.env.TTS_START_FRAMES || 10), pacerMs = 20, signal, voiceSettings, language_code = "he", sequenceRef, } = opts;
    if (!voiceId)
        throw new Error("voiceId required (set ELEVENLABS_VOICE_ID)");
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey)
        throw new Error("ELEVENLABS_API_KEY not set");
    const qs = new URLSearchParams();
    qs.set("output_format", "ulaw_8000");
    const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?${qs.toString()}`;
    const body = {
        text,
        model_id: modelId,
        language_code,
        ...(voiceSettings ? { voice_settings: voiceSettings } : {}),
    };
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
    const tFetchStart = performance.now();
    let res;
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
    const ct = res.headers?.get?.("content-type") ?? "";
    console.log(`[TTS upstream] status=${res.status} ct=${ct}`);
    if (!res.ok || !res.body) {
        cleanupAbort();
        const msg = (await res.text?.().catch?.(() => res.statusText)) ??
            String(res.statusText ?? "upstream error");
        throw new Error(`ElevenLabs upstream error ${res.status}: ${msg}`);
    }
    // Use Uint8Array (generic unified) for carry/queue
    const queue = [];
    let carry = new Uint8Array(0);
    let localSeq = 0;
    const nextSeq = () => (sequenceRef ? ++sequenceRef.value : ++localSeq);
    let sentFrames = 0;
    // Pacer state
    let pacing = false;
    let pacerTimer;
    let t0 = performance.now();
    let tick = 0;
    let firstFrameMs = -1;
    // חדש: דגל שמסמן ש־ElevenLabs סיים להזרים
    let upstreamDone = false;
    const startPacer = () => {
        if (pacing)
            return;
        pacing = true;
        const step = () => {
            if (ws.readyState !== WebSocket.OPEN)
                return;
            if (canceled)
                return;
            const due = t0 + ++tick * pacerMs;
            const now = performance.now();
            const frame = queue.length ? queue.shift() : ULawSilenceU8;
            ws.send(JSON.stringify({
                event: "media",
                streamSid,
                sequenceNumber: String(nextSeq()),
                media: { payload: toB64(frame) },
            }));
            sentFrames++;
            const delay = Math.max(0, due - now);
            pacerTimer = setTimeout(step, delay);
        };
        pacerTimer = setTimeout(step, pacerMs);
    };
    const flushCarryAsFrame = () => {
        if (carry.length > 0) {
            const padded = new Uint8Array(FRAME_BYTES);
            padded.fill(0xff);
            padded.set(carry.subarray(0, Math.min(carry.length, FRAME_BYTES)), 0);
            queue.push(padded);
            carry = new Uint8Array(0);
        }
    };
    // Reader → push 160-byte frames into queue
    (async () => {
        try {
            const maybeReader = res.body;
            const reader = typeof maybeReader?.getReader === "function"
                ? maybeReader.getReader()
                : null;
            const onChunk = (chunk) => {
                const data = carry.length ? concatU8(carry, chunk) : chunk;
                let off = 0;
                while (off + FRAME_BYTES <= data.length) {
                    if (firstFrameMs < 0)
                        firstFrameMs = performance.now() - tFetchStart;
                    queue.push(data.subarray(off, off + FRAME_BYTES));
                    off += FRAME_BYTES;
                }
                carry =
                    off < data.length
                        ? data.subarray(off)
                        : new Uint8Array(0);
                if (!pacing && queue.length >= startBufferFrames) {
                    t0 = performance.now();
                    startPacer();
                }
            };
            if (reader) {
                while (true) {
                    if (ctrl.signal.aborted)
                        break;
                    const { value, done } = await reader.read();
                    if (done) {
                        upstreamDone = true;
                        flushCarryAsFrame();
                        break;
                    }
                    if (!value?.length)
                        continue;
                    onChunk(value);
                }
            }
            else {
                const { Readable } = await import("node:stream");
                for await (const chunk of Readable.fromWeb(res.body)) {
                    if (ctrl.signal.aborted)
                        break;
                    onChunk(chunk);
                }
                upstreamDone = true;
                flushCarryAsFrame();
            }
        }
        catch (e) {
            if (e?.name === "AbortError") {
                canceled = true;
            }
            else {
                console.error("[TTS stream read error]", e?.message || e);
            }
            upstreamDone = true;
            flushCarryAsFrame();
        }
    })();
    // Drain loop
    try {
        while (!ctrl.signal.aborted) {
            if (!pacing && queue.length > 0) {
                t0 = performance.now();
                startPacer();
            }
            // יוצאים רק כשאין יותר אודיו מהשרת וגם התור ריק
            if (upstreamDone && queue.length === 0)
                break;
            await sleep(10);
        }
    }
    finally {
        cleanupAbort();
        if (pacerTimer)
            clearTimeout(pacerTimer);
        try {
            if (ws.readyState === WebSocket.OPEN && !canceled) {
                ws.send(JSON.stringify({
                    event: "mark",
                    streamSid,
                    mark: { name: "tts_end" },
                }));
            }
        }
        catch { }
        const ttff = firstFrameMs >= 0 ? Math.round(firstFrameMs) : -1;
        console.log(`[TTS] frames sent: ${sentFrames} (canceled=${ctrl.signal.aborted}) ttff_ms=${ttff}`);
    }
    return ctrl.signal.aborted ? "canceled" : "ok";
}
export default speakTextToTwilio;
