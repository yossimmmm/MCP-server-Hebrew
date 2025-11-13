import { WebSocketServer } from "ws";
import { performance } from "node:perf_hooks";
import speakTextToTwilio from "../tts/elevenToTwilio.js";
import { createGoogleSession } from "../stt/google.js";
import { createHebrewChirp3Stream } from "../stt/googleChirpV2.js";
import { LlmSession } from "../nlu/gemini.js";
// נורמליזציה: גם אם ב-env כתוב 12, בפועל עובדים בין 3 ל-5
const RAW_BARGE_IN_MIN_CHARS = Number(process.env.BARGE_IN_MIN_CHARS || "5");
const BARGE_IN_MIN_CHARS = Number.isFinite(RAW_BARGE_IN_MIN_CHARS)
    ? Math.max(3, Math.min(RAW_BARGE_IN_MIN_CHARS, 5))
    : 3;
const TTS_START_FRAMES = Number(process.env.TTS_START_FRAMES || "10");
const PACER_MS = Number(process.env.TTS_PACER_MS || process.env.TTS_PACER_MS || "20");
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "eleven_v3";
const DEFAULT_LANG = process.env.TTS_LANGUAGE_CODE || "he";
const CALL_GREETING = process.env.CALL_GREETING || "";
// כמה זמן לחכות ל-preview שרץ לפני שנופלים לפולבאק (ms)
const LLM_PREVIEW_WAIT_MS = Number(process.env.LLM_PREVIEW_WAIT_MS || "300");
// STT engine selector; default to v1 unless recognizer is provided
const STT_ENGINE = String(process.env.STT_ENGINE || "").toLowerCase(); // "v1" | "v2"
const V2_RECOGNIZER = process.env.GC_STT_RECOGNIZER || ""; // projects/{proj}/locations/{loc}/recognizers/{id or _}
const V2_API_ENDPOINT = process.env.GC_STT_API_ENDPOINT || deriveEndpointFromRecognizer(V2_RECOGNIZER);
function deriveEndpointFromRecognizer(recognizer) {
    const m = recognizer.match(/\/locations\/([^/]+)/i);
    const loc = m?.[1];
    if (!loc || loc.toLowerCase() === "global") {
        return undefined; // use library default "speech.googleapis.com"
    }
    return `${loc}-speech.googleapis.com`;
}
// Map XI_* env into voice settings for Eleven v3
function envVoiceSettings() {
    const num = (k) => process.env[k] != null ? Number(process.env[k]) : undefined;
    const bool = (k, def) => process.env[k] != null ? !/^(false|0)$/i.test(String(process.env[k])) : def;
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const snap = (v, choices) => choices.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), choices[0]);
    const vs = {};
    const s = num("XI_STABILITY");
    if (s != null && !Number.isNaN(s)) {
        vs.stability = snap(s, [0, 0.5, 1]);
    }
    const sim = num("XI_SIMILARITY") ?? num("XI_SIMILARITY_BOOST");
    if (sim != null && !Number.isNaN(sim)) {
        vs.similarity_boost = clamp01(sim);
    }
    const style = num("XI_STYLE");
    if (style != null && !Number.isNaN(style)) {
        vs.style = clamp01(style);
    }
    const boost = bool("XI_SPEAKER_BOOST", false);
    if (boost && process.env.DEFAULT_MODEL !== "eleven_v3") {
        vs.use_speaker_boost = true;
    }
    const rate = num("XI_SPEAKING_RATE");
    if (rate != null && !Number.isNaN(rate)) {
        // נשאיר את זה כמו שהוא אצלך – אם תרצה נעשה טיונינג מהיר בקובץ נפרד
        vs.speaking_rate = rate;
    }
    return Object.keys(vs).length ? vs : undefined;
}
function now() {
    return new Date().toISOString();
}
// נירמול טקסט להשוואה "בערך"
function normalizeText(s) {
    return (s || "")
        .toLowerCase()
        .replace(/[.,!?;:"'׳״()\-–—]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function isCloseEnough(a, b) {
    const na = normalizeText(a);
    const nb = normalizeText(b);
    if (!na || !nb)
        return false;
    return (na === nb ||
        na.startsWith(nb) ||
        nb.startsWith(na) ||
        na.includes(nb) ||
        nb.includes(na));
}
export function attachTwilioWs(server) {
    const wss = new WebSocketServer({ server, path: "/ws/twilio" });
    wss.on("connection", (ws, req) => {
        console.log(`[twilio][ws] connection opened ${now()} from ${req.socket.remoteAddress}`);
        let streamSid;
        let ttsAbort;
        let closed = false;
        const llm = new LlmSession();
        const seqRef = { value: 0 };
        // === LLM preview state ===
        let latestUserText = "";
        let latestPreviewText = "";
        let latestPreviewReply = "";
        let llmInFlight = null;
        const speak = async (text) => {
            if (closed)
                return;
            if (!text || !text.trim())
                return;
            if (!streamSid) {
                console.warn("[twilio][tts] called without streamSid");
                return;
            }
            try {
                ttsAbort?.abort();
            }
            catch {
                // ignore
            }
            ttsAbort = new AbortController();
            try {
                console.log("[TTS] speak() called, text length =", text.length);
                await speakTextToTwilio(ws, streamSid, text, {
                    signal: ttsAbort.signal,
                    startBufferFrames: TTS_START_FRAMES,
                    pacerMs: PACER_MS,
                    modelId: DEFAULT_MODEL,
                    language_code: DEFAULT_LANG,
                    voiceSettings: envVoiceSettings(),
                    sequenceRef: seqRef,
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
        // PARTIAL → להרים preview + barge-in
        function handlePartialText(text) {
            if (!text)
                return;
            latestUserText = text;
            const nonSpaceLen = text.replace(/\s/g, "").length;
            console.log("[PARTIAL handle] text=", text, "| nonSpaceLen=", nonSpaceLen, "| threshold=", BARGE_IN_MIN_CHARS);
            if (nonSpaceLen < BARGE_IN_MIN_CHARS) {
                console.log("[PARTIAL handle] below threshold → no barge-in, no preview yet");
                return;
            }
            console.log("[BARGE-IN] aborting current TTS because partial reached threshold");
            try {
                ttsAbort?.abort();
            }
            catch {
                // ignore
            }
            ttsAbort = undefined;
            if (llmInFlight) {
                console.log("[LLM preview] already in-flight, skipping another preview call");
                return;
            }
            const previewInput = text;
            latestPreviewText = previewInput;
            console.log("[LLM preview] starting for partial:", previewInput);
            llmInFlight = (async () => {
                try {
                    const t0 = performance.now();
                    const reply = await llm.reply(previewInput);
                    const dt = Math.round(performance.now() - t0);
                    console.log("[LLM preview done] ms=", dt, "reply=", reply);
                    latestPreviewReply = reply;
                    return reply;
                }
                catch (e) {
                    console.error("[LLM preview error]", e?.message || e);
                    return "";
                }
                finally {
                    llmInFlight = null;
                }
            })();
        }
        // FINAL → להשתמש ב-preview אם אפשר, אחרת פולבאק מלא
        async function handleFinalText(finalText) {
            const cleaned = (finalText || "").trim();
            if (!cleaned)
                return;
            console.log("[FINAL handle] text=", cleaned);
            const tryUsePreview = async () => {
                if (latestPreviewReply && latestPreviewText) {
                    if (isCloseEnough(cleaned, latestPreviewText)) {
                        console.log("[LLM] using existing preview reply");
                        return latestPreviewReply;
                    }
                }
                if (llmInFlight) {
                    console.log("[LLM] waiting for in-flight preview up to", LLM_PREVIEW_WAIT_MS, "ms");
                    try {
                        const result = await Promise.race([
                            llmInFlight,
                            new Promise((resolve) => setTimeout(() => resolve(""), LLM_PREVIEW_WAIT_MS)),
                        ]);
                        if (result &&
                            latestPreviewReply &&
                            latestPreviewText &&
                            isCloseEnough(cleaned, latestPreviewText)) {
                            console.log("[LLM] in-flight preview finished in time, using preview reply");
                            return latestPreviewReply;
                        }
                    }
                    catch (e) {
                        console.error("[LLM] error while waiting for preview:", e?.message || e);
                    }
                }
                return "";
            };
            let reply = await tryUsePreview();
            if (!reply) {
                const t0 = performance.now();
                reply = await llm.reply(cleaned);
                const dt = Math.round(performance.now() - t0);
                console.log("[LLM final ms]", dt);
            }
            if (!streamSid)
                return;
            await speak(reply);
        }
        // Install STT (v2 with fallback to v1 on any error)
        let sttWrite = () => { };
        let sttEnd = () => { };
        let sttDead = false;
        const installV1 = (why) => {
            sttDead = false;
            if (why)
                console.warn(`[STT] Switching to v1 because: ${why}`);
            const sttV1 = createGoogleSession({
                onPartial: (txt) => {
                    console.log("[STT v1 partial]", txt);
                    handlePartialText(txt);
                },
                onFinal: (finalText) => {
                    console.log("[STT v1 final]", finalText);
                    handleFinalText(finalText).catch((e) => console.error("[LLM final v1 error]", e?.message || e));
                },
            });
            sttWrite = (b64) => {
                if (!sttDead)
                    sttV1.writeMuLaw(b64);
            };
            sttEnd = () => sttV1.end();
        };
        const installV2 = () => {
            sttDead = false;
            if (!V2_RECOGNIZER ||
                !/^projects\/[^/]+\/locations\/[^/]+\/recognizers\/[^/]+$/i.test(V2_RECOGNIZER)) {
                installV1("invalid or missing GC_STT_RECOGNIZER");
                return;
            }
            const sttV2 = createHebrewChirp3Stream(V2_RECOGNIZER, {
                apiEndpoint: V2_API_ENDPOINT,
                languageCode: process.env.STT_LANGUAGE_CODE,
                interimResults: true,
                onData: (text, isFinal) => {
                    console.log(isFinal ? "[STT v2 FINAL raw]" : "[STT v2 PARTIAL raw]", text);
                    if (!text)
                        return;
                    if (isFinal) {
                        handleFinalText(text).catch((e) => console.error("[LLM final v2 error]", e?.message || e));
                    }
                    else {
                        handlePartialText(text);
                    }
                },
                onError: (e) => {
                    console.error("[STT v2 error]", e?.message || e);
                    sttDead = true;
                    installV1(e?.message || "v2 stream error");
                },
                onEnd: () => {
                    console.log("[STT v2 end]");
                    sttDead = true;
                },
            });
            sttWrite = (b64) => {
                if (!sttDead)
                    sttV2.writeMuLawBase64(b64);
            };
            sttEnd = () => sttV2.end();
        };
        if (STT_ENGINE === "v2" && V2_RECOGNIZER) {
            installV2();
        }
        else {
            installV1(!V2_RECOGNIZER && STT_ENGINE === "v2"
                ? "GC_STT_RECOGNIZER not set"
                : undefined);
        }
        ws.on("message", async (data) => {
            try {
                const msg = JSON.parse(String(data));
                switch (msg.event) {
                    case "start":
                        streamSid = msg.start?.streamSid;
                        console.log(`[twilio] start streamSid=${streamSid} (BARGE_IN_MIN_CHARS=${BARGE_IN_MIN_CHARS})`);
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
