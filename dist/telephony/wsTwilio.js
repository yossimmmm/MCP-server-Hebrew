import { WebSocketServer, WebSocket } from "ws";
import { createGoogleSession } from "../stt/google.js";
import { speakTextToTwilio } from "../tts/elevenToTwilio.js";
import { LlmSession } from "../nlu/gemini.js";
export function attachTwilioWs(server) {
    const wss = new WebSocketServer({ server, path: "/ws/twilio" });
    wss.on("connection", (ws) => {
        console.log("[WS] Twilio connected");
        let streamSid = "";
        let inboundFrames = 0;
        const voiceId = process.env.ELEVENLABS_VOICE_ID;
        // One LLM chat session per call (keeps context)
        let llm = null;
        // Simple FIFO so replies don't overlap
        const toSay = [];
        let speaking = false;
        function enqueue(text) {
            if (!text || !text.trim())
                return;
            toSay.push(text.trim());
            drain();
        }
        async function drain() {
            if (speaking)
                return;
            speaking = true;
            while (toSay.length && ws.readyState === WebSocket.OPEN) {
                const text = toSay.shift();
                try {
                    await speakTextToTwilio(ws, streamSid, text, voiceId);
                }
                catch (e) {
                    console.error("[TTS] speak error:", e?.message || e);
                    break;
                }
            }
            speaking = false;
        }
        const stt = createGoogleSession({
            onFinal: (text) => {
                console.log("[STT final]", text);
                // Call Gemini asynchronously so we don't block WS handler
                (async () => {
                    try {
                        if (!llm)
                            llm = new LlmSession();
                        const reply = await llm.reply(text);
                        enqueue(reply);
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
                case "media": {
                    const payload = msg.media?.payload;
                    if (payload)
                        stt.writeMuLaw(payload);
                    inboundFrames++;
                    if (inboundFrames % 50 === 0) {
                        console.log("[WS] inbound media frames:", inboundFrames);
                    }
                    break;
                }
                case "stop":
                    console.log("[WS] stop", streamSid);
                    try {
                        stt.end();
                    }
                    catch { }
                    try {
                        ws.close();
                    }
                    catch { }
                    break;
                case "mark":
                    // "tts_end" arrives from speakTextToTwilio after each clip
                    break;
                default:
                    break;
            }
        });
        const cleanup = () => {
            try {
                stt.end();
            }
            catch { }
            console.log("[WS] closed");
        };
        ws.once("close", cleanup);
        ws.once("error", cleanup);
    });
}
export default attachTwilioWs;
//# sourceMappingURL=wsTwilio.js.map