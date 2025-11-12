import { WebSocketServer, WebSocket } from "ws";
import speakTextToTwilio from "../tts/elevenToTwilio.js";
import { createGoogleSession } from "../stt/google.js";
import { LlmSession } from "../nlu/gemini.js";
export function attachTwilioWs(server) {
    const wss = new WebSocketServer({ server, path: "/ws/twilio" });
    wss.on("connection", (ws) => {
        console.log("[WS] Twilio connected");
        let streamSid = "";
        const voiceId = process.env.ELEVENLABS_VOICE_ID || "";
        let llm = null;
        // Simple TTS queue with barge‑in cancel
        const queue = [];
        let speaking = false;
        let currentAbort = null;
        function cancelCurrent(reason = "barge-in") {
            if (currentAbort && !currentAbort.signal.aborted) {
                console.log(`[TTS] cancel current due to ${reason}`);
                currentAbort.abort();
            }
        }
        function enqueue(text) {
            const t = (text || "").trim();
            if (!t)
                return;
            queue.push(t);
            drain().catch((e) => console.error("[drain error]", e));
        }
        async function drain() {
            if (speaking)
                return;
            speaking = true;
            try {
                while (queue.length && ws.readyState === WebSocket.OPEN) {
                    const text = queue.shift();
                    currentAbort = new AbortController();
                    const voiceSettings = {
                        stability: 0.5, // must be 0, 0.5, or 1 for eleven_v3
                        similarity_boost: 0.75, // optional
                        style: 0.35, // optional
                        use_speaker_boost: true, // optional
                        // speaking_rate: <omit unless your tenant supports it>
                    };
                    const r = await speakTextToTwilio(ws, streamSid, text, {
                        voiceId,
                        modelId: process.env.DEFAULT_MODEL || "eleven_v3",
                        startBufferFrames: Number(process.env.TTS_START_FRAMES || 12),
                        pacerMs: 20,
                        signal: currentAbort.signal,
                        voiceSettings,
                        language_code: "he",
                    });
                    if (r === "canceled")
                        queue.length = 0;
                }
            }
            finally {
                speaking = false;
                currentAbort = null;
            }
        }
        // Barge-in on meaningful partials
        function maybeBargeIn(partial) {
            if (!partial || !speaking)
                return;
            const norm = partial.replace(/\s+/g, " ").trim();
            if (norm.length >= 6)
                cancelCurrent("stt-partial");
        }
        const stt = createGoogleSession({
            onPartial: maybeBargeIn,
            onFinal: (text) => {
                (async () => {
                    try {
                        if (!llm)
                            llm = new LlmSession();
                        const reply = await llm.reply(text);
                        for (const phrase of splitForPhone(reply))
                            enqueue(phrase);
                    }
                    catch (err) {
                        console.error("[LLM] error:", err?.message || err);
                        enqueue("סליחה, נתקלה בעיה לרגע. אפשר לחזור על השאלה?");
                    }
                })();
            },
        });
        ws.on("message", (buf) => {
            let msg;
            try {
                msg = JSON.parse(buf.toString());
            }
            catch {
                return;
            }
            switch (msg.event) {
                case "start":
                    streamSid = msg.start?.streamSid || "";
                    console.log("[WS] start", streamSid);
                    try {
                        llm = new LlmSession();
                    }
                    catch (e) {
                        console.error("[LLM] init error:", e?.message || e);
                    }
                    if (process.env.CALL_GREETING)
                        enqueue(process.env.CALL_GREETING);
                    break;
                case "media":
                    if (msg.media?.payload) {
                        // inbound μ-law base64 → STT
                        stt.writeMuLaw(msg.media.payload);
                    }
                    break;
                case "stop":
                    console.log("[WS] stop", streamSid);
                    try {
                        stt.end();
                    }
                    catch { }
                    try {
                        cancelCurrent("ws-stop");
                    }
                    catch { }
                    try {
                        ws.close();
                    }
                    catch { }
                    break;
            }
        });
        const cleanup = () => {
            try {
                stt.end();
            }
            catch { }
            try {
                cancelCurrent("ws-close");
            }
            catch { }
            console.log("[WS] closed");
        };
        ws.once("close", cleanup);
        ws.once("error", cleanup);
    });
}
function splitForPhone(s) {
    const raw = (s || "").replace(/\s+/g, " ").trim();
    if (!raw)
        return [];
    const out = [];
    let cur = "";
    for (const part of raw.split(/([.?!…]|,|;|:)/)) {
        if (!part)
            continue;
        cur += part;
        if (/[.?!…]/.test(part) || cur.length > 60) {
            out.push(cur.trim());
            cur = "";
        }
    }
    if (cur.trim())
        out.push(cur.trim());
    return out;
}
export default attachTwilioWs;
