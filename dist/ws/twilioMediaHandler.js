import { createHebrewChirp3Stream } from "../stt/googleChirpV2.js";
export function handleTwilioWs(ws) {
    const recognizer = process.env.GC_STT_RECOGNIZER ??
        "projects/<PROJECT>/locations/global/recognizers/hebrew-reco";
    const stt = createHebrewChirp3Stream(recognizer, {
        onData: (text, isFinal) => {
            console.log(`[STT ${isFinal ? "final" : "interim"}]`, text);
        },
        onError: (e) => console.error("[STT error]", e.message),
        onEnd: () => console.log("[STT] ended"),
    });
    ws.on("message", (raw) => {
        try {
            const msg = JSON.parse(String(raw));
            switch (msg.event) {
                case "start":
                    console.log("[Twilio] stream started", msg.start);
                    break;
                case "media": // μ-law 8 kHz base64
                    stt.writeMuLawBase64(msg.media.payload);
                    break;
                case "stop":
                    console.log("[Twilio] stream stopped");
                    stt.end();
                    break;
                case "mark":
                default:
                    break;
            }
        }
        catch (e) {
            console.error("[Twilio WS parse error]", e?.message || e);
        }
    });
    ws.on("close", () => {
        try {
            stt.end();
        }
        catch { }
    });
    ws.on("error", (e) => console.error("[Twilio WS error]", e));
}
