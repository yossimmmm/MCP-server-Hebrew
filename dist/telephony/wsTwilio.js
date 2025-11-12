import { WebSocketServer } from "ws";
import speakTextToTwilio from "../tts/elevenToTwilio.js";
import { createGoogleSession } from "../stt/google.js";
import { createHebrewChirp3Stream } from "../stt/googleChirpV2.js";
import { LlmSession } from "../nlu/gemini.js";
const BARGE_IN_MIN_CHARS = Number(process.env.BARGE_IN_MIN_CHARS || "5");
const TTS_START_FRAMES = Number(process.env.TTS_START_FRAMES || "10");
const PACER_MS = Number(process.env.TTS_PACER_MS || process.env.PACER_MS || "20");
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "eleven_v3";
const DEFAULT_LANG = process.env.TTS_LANGUAGE_CODE || "he";
const CALL_GREETING = process.env.CALL_GREETING || "";
const LLM_TRIGGER_DEBOUNCE_MS = Number(process.env.LLM_TRIGGER_DEBOUNCE_MS || "220");
// STT engine selector; default to v1 unless recognizer is provided
const STT_ENGINE = String(process.env.STT_ENGINE || "").toLowerCase(); // "v1" | "v2"
const V2_RECOGNIZER = process.env.GC_STT_RECOGNIZER || ""; // projects/{proj}/locations/{loc}/recognizers/{id or _}
const V2_API_ENDPOINT = process.env.GC_STT_API_ENDPOINT || deriveEndpointFromRecognizer(V2_RECOGNIZER);
function deriveEndpointFromRecognizer(recognizer) {
    const m = recognizer.match(/\/locations\/([^/]+)/i);
    const loc = m?.[1];
    if (!loc || loc.toLowerCase() === "global") {
        // Default global API endpoint works for default recognizer "_" and non-Chirp models
        return undefined; // use library default "speech.googleapis.com"
    }
    // For Chirp in specific regions use region endpoint, e.g. "us-central1-speech.googleapis.com"
    return `${loc}-speech.googleapis.com`;
}
// Map XI_* env into voice settings (with safe snapping for v3)
function envVoiceSettings() {
    const num = (k) => (process.env[k] != null ? Number(process.env[k]) : undefined);
    const bool = (k, def) => process.env[k] != null ? !/^(false|0)$/i.test(String(process.env[k])) : def;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const snap = (v, choices) => choices.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), choices[0]);
    const vs = {};
    const s = num("XI_STABILITY");
    if (s != null && !Number.isNaN(s))
        vs.stability = snap(s, [0, 0.5, 1]);
    const sim = num("XI_SIMILARITY") ?? num("XI_SIMILARITY_BOOST");
    if (sim != null)
        vs.similarity_boost = clamp01(sim);
    const style = num("XI_STYLE");
    if (style != null)
        vs.style = clamp01(style);
    const boost = bool("XI_SPEAKER_BOOST", true);
    if (boost != null)
        vs.use_speaker_boost = boost;
    const rate = num("XI_SPEAKING_RATE");
    if (rate != null)
        vs.speaking_rate = Math.max(0.5, Math.min(2, rate));
    return Object.keys(vs).length ? vs : undefined;
}
function now() {
    return new Date().toISOString();
}
export function attachTwilioWs(server) {
    const wss = new WebSocketServer({ server, path: "/ws/twilio" });
    wss.on("connection", (ws, req) => {
        console.log(`[twilio][ws] connection opened ${now()} from ${req.socket.remoteAddress}`);
        let streamSid;
        let ttsAbort;
        let closed = false;
        // Single LLM chat per call
        const llm = new LlmSession();
        // One global Twilio media sequence per call
        const seqRef = { value: 0 };
        // Debounce final STT results
        let replyTimer = null;
        let pendingText = null;
        const speak = async (text) => {
            try {
                ttsAbort?.abort();
            }
            catch { }
            ttsAbort = new AbortController();
            try {
                await speakTextToTwilio(ws, streamSid, text, {
                    signal: ttsAbort.signal,
                    startBufferFrames: TTS_START_FRAMES,
                    pacerMs: PACER_MS,
                    modelId: DEFAULT_MODEL,
                    language_code: DEFAULT_LANG,
                    voiceSettings: envVoiceSettings(),
                    sequenceRef: seqRef, // keep sequence increasing across chunks
                });
            }
            catch (e) {
                if (e?.name !== "AbortError") {
                    console.error("[twilio][tts] error:", e?.message || e);
                }
            }
            finally {
                ttsAbort = undefined;
            }
        };
        // Install STT (v2 with fallback to v1 on any error)
        let sttWrite = () => { };
        let sttEnd = () => { };
        let sttDead = false;
        const installV1 = (why) => {
            if (why)
                console.warn(`[STT] Switching to v1 because: ${why}`);
            const sttV1 = createGoogleSession({
                onPartial: (txt) => {
                    if (txt.replace(/\s/g, "").length >= BARGE_IN_MIN_CHARS) {
                        try {
                            ttsAbort?.abort();
                        }
                        catch { }
                        ttsAbort = undefined;
                    }
                },
                onFinal: (finalText) => {
                    pendingText = finalText;
                    if (replyTimer)
                        clearTimeout(replyTimer);
                    replyTimer = setTimeout(async () => {
                        const text = pendingText;
                        pendingText = null;
                        const reply = await llm.reply(text);
                        if (!streamSid)
                            return;
                        await speak(reply);
                    }, LLM_TRIGGER_DEBOUNCE_MS);
                },
            });
            sttWrite = (b64) => {
                if (!sttDead)
                    sttV1.writeMuLaw(b64);
            };
            sttEnd = () => sttV1.end();
        };
        const installV2 = () => {
            if (!V2_RECOGNIZER || !/^projects\/[^/]+\/locations\/[^/]+\/recognizers\/[^/]+$/i.test(V2_RECOGNIZER)) {
                installV1("invalid or missing GC_STT_RECOGNIZER");
                return;
            }
            const sttV2 = createHebrewChirp3Stream(V2_RECOGNIZER, {
                apiEndpoint: V2_API_ENDPOINT, // may be undefined → library default
                languageCode: process.env.STT_LANGUAGE_CODE || "he-IL",
                model: process.env.GC_STT_MODEL || "chirp",
                interimResults: true,
                onData: (text, isFinal) => {
                    if (!text)
                        return;
                    if (isFinal) {
                        pendingText = text;
                        if (replyTimer)
                            clearTimeout(replyTimer);
                        replyTimer = setTimeout(async () => {
                            const t = pendingText;
                            pendingText = null;
                            const reply = await llm.reply(t);
                            if (!streamSid)
                                return;
                            await speak(reply);
                        }, LLM_TRIGGER_DEBOUNCE_MS);
                    }
                    else {
                        if (text.replace(/\s/g, "").length >= BARGE_IN_MIN_CHARS) {
                            try {
                                ttsAbort?.abort();
                            }
                            catch { }
                            ttsAbort = undefined;
                        }
                    }
                },
                onError: (e) => {
                    console.error("[STT v2 error]", e?.message || e);
                    sttDead = true;
                    installV1(e?.message || "v2 stream error");
                },
                onEnd: () => {
                    sttDead = true;
                },
            });
            sttWrite = (b64) => {
                if (!sttDead)
                    sttV2.writeMuLawBase64(b64);
            };
            sttEnd = () => sttV2.end();
        };
        // Choose engine: v2 only if explicitly selected and recognizer present
        if (STT_ENGINE === "v2" && V2_RECOGNIZER) {
            installV2();
        }
        else {
            installV1(!V2_RECOGNIZER && STT_ENGINE === "v2" ? "GC_STT_RECOGNIZER not set" : undefined);
        }
        ws.on("message", async (data) => {
            try {
                const msg = JSON.parse(String(data));
                switch (msg.event) {
                    case "start":
                        streamSid = msg.start?.streamSid;
                        console.log(`[twilio] start streamSid=${streamSid}`);
                        if (CALL_GREETING) {
                            speak(CALL_GREETING).catch((e) => {
                                if (e?.name !== "AbortError") {
                                    console.error("[twilio][tts greeting] error:", e?.message || e);
                                }
                            });
                        }
                        break;
                    case "media":
                        if (msg.media?.payload)
                            sttWrite(msg.media.payload);
                        break;
                    case "stop":
                        console.log(`[twilio] stop streamSid=${msg.streamSid || streamSid}`);
                        cleanup();
                        break;
                    default:
                        break;
                }
            }
            catch (e) {
                console.error("[twilio][ws] message error:", e?.message || e);
            }
        });
        ws.on("close", () => {
            console.log("[twilio][ws] closed");
            cleanup();
        });
        ws.on("error", (err) => {
            console.error("[twilio][ws] error:", err?.message || err);
            cleanup();
        });
        function cleanup() {
            if (closed)
                return;
            closed = true;
            try {
                ttsAbort?.abort();
            }
            catch { }
            try {
                sttEnd?.();
            }
            catch { }
        }
    });
    console.log("[twilio] WebSocket server attached at /ws/twilio");
}
export default attachTwilioWs;
