// src/telephony/wsTwilio.ts
import { WebSocketServer } from "ws";
import { createGoogleStt } from "../stt/google.js";
import { speakElevenToTwilio } from "../tts/elevenToTwilio.js";
export function attachTwilioWs(server) {
    const wss = new WebSocketServer({ noServer: true });
    // Upgrade רק לנתיב /ws/twilio
    server.on("upgrade", (req, socket, head) => {
        if (!req.url?.startsWith("/ws/twilio"))
            return;
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });
    wss.on("connection", (ws) => {
        let streamSid = "";
        let playing = false; // מנגן כרגע TTS
        const stt = createGoogleStt({
            languageCode: "he-IL",
            sampleRateHertz: 8000,
            onPartial: (text) => {
                // בראג'-אין: אם יש דיבור נכנס בזמן ניגון, תנקה תור ניגון
                if (playing) {
                    try {
                        ws.send(JSON.stringify({ event: "clear", streamSid }));
                    }
                    catch { }
                }
            },
            onFinal: async (text) => {
                // פה אתה יכול להחליף בלוגיקה/בוט/DF-CX; כרגע — פשוט מחזיר תשובה
                if (!text.trim())
                    return;
                playing = true;
                try {
                    await speakElevenToTwilio({
                        ws,
                        streamSid,
                        text,
                        voiceId: process.env.ELEVENLABS_VOICE_ID || "",
                        speed: 1.0,
                        model: process.env.DEFAULT_MODEL || "eleven_v3",
                    });
                    // סימון סיום קטע (לא חובה)
                    ws.send(JSON.stringify({ event: "mark", streamSid, mark: { name: "tts_end" } }));
                }
                catch (e) {
                    console.error("TTS stream error:", e);
                }
                finally {
                    playing = false;
                }
            },
            onError: (e) => console.error("STT error:", e),
            onEnd: () => { }
        });
        ws.on("message", (data) => {
            try {
                const msg = JSON.parse(String(data));
                if (msg.event === "start") {
                    streamSid = msg.start.streamSid;
                    // התחלת סטרים לזיהוי
                    stt.start();
                }
                else if (msg.event === "media") {
                    // payload הוא base64 של μ-law 8k מ-Twilio
                    const buf = Buffer.from(msg.media.payload, "base64");
                    stt.writeMuLaw(buf);
                }
                else if (msg.event === "stop") {
                    stt.stop();
                    ws.close();
                }
            }
            catch (e) {
                console.error("WS parse error:", e);
            }
        });
        ws.on("close", () => {
            stt.stop();
        });
    });
    console.log("Twilio WS ready on path /ws/twilio");
}
