import WebSocket, { WebSocketServer } from "ws";
import { createGoogleSession } from "../stt/google.js";
import { speakTextToTwilio } from "../tts/elevenToTwilio.js";
function send(ws, obj) {
    if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(obj));
}
export function attachTwilioWs(server) {
    const wss = new WebSocketServer({ server, path: "/ws/twilio" });
    wss.on("connection", (ws) => {
        console.log("[WS] Twilio connected");
        const sessions = new Map();
        let mediaCount = 0;
        const endAll = () => {
            for (const s of sessions.values()) {
                try {
                    s.end();
                }
                catch { }
            }
            sessions.clear();
        };
        ws.on("message", async (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            }
            catch {
                return;
            }
            switch (msg.event) {
                case "start": {
                    const streamSid = msg.start?.streamSid ?? msg.streamSid;
                    if (!streamSid) {
                        console.error("[WS] start event missing streamSid");
                        break;
                    }
                    console.log("[WS] start", streamSid);
                    sessions.get(streamSid)?.end();
                    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
                        sessions.set(streamSid, createGoogleSession());
                    }
                    else {
                        console.warn("STT disabled: GOOGLE_APPLICATION_CREDENTIALS missing");
                    }
                    try {
                        await speakTextToTwilio(ws, streamSid, "היי, השיחה עלתה. תגיד משהו ואני אשמע.");
                    }
                    catch (e) {
                        console.error("TTS->Twilio failed:", e?.message || e);
                    }
                    break;
                }
                case "media": {
                    const streamSid = msg.streamSid;
                    if (!streamSid)
                        break;
                    if ((++mediaCount % 50) === 0)
                        console.log("[WS] inbound media frames:", mediaCount);
                    const s = sessions.get(streamSid);
                    if (!s)
                        break;
                    const b64 = msg.media?.payload;
                    if (!b64)
                        break;
                    const ok = s.writeMuLaw(b64);
                    if (!ok)
                        sessions.delete(streamSid);
                    break;
                }
                case "mark": {
                    // optional: handle marks you sent (e.g., "tts_end")
                    break;
                }
                case "stop": {
                    const streamSid = msg.stop?.streamSid ?? msg.streamSid;
                    console.log("[WS] stop", streamSid || "(none)");
                    if (streamSid && sessions.has(streamSid)) {
                        sessions.get(streamSid)?.end();
                        sessions.delete(streamSid);
                    }
                    break;
                }
                default:
                    break;
            }
        });
        ws.on("close", () => { console.log("[WS] closed"); endAll(); });
        ws.on("error", (e) => { console.error("[WS] error", e?.message || e); endAll(); });
    });
}
//# sourceMappingURL=wsTwilio.js.map