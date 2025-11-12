// src/tts/elevenToTwilio.ts
import { spawn } from "child_process";
import WebSocket from "ws";
import { Readable } from "node:stream";
/**
 * ממיר טקסט לאודיו דרך /stream/tts, משנמך ל-μ-law 8kHz,
 * ושולח לטוויליו כפריימים של 160 בייט עם sequenceNumber.
 */
export async function speakTextToTwilio(ws, streamSid, text, voiceId) {
    if (!streamSid)
        throw new Error("Missing streamSid for outbound audio");
    const base = process.env.PUBLIC_BASE_URL;
    if (!base)
        throw new Error("PUBLIC_BASE_URL not set");
    // בונים את ה-URL לשירות ה-TTS שלך שמחזיר MP3 בזרימה
    const url = new URL("/stream/tts", base);
    url.searchParams.set("text", text);
    url.searchParams.set("output_format", "mp3_44100_128");
    if (voiceId)
        url.searchParams.set("voice_id", voiceId);
    // מביאים סטרים MP3
    const res = await fetch(url.toString());
    if (!res.ok || !res.body) {
        throw new Error("TTS HTTP " + res.status);
    }
    // ממירים MP3 → μ-law 8kHz מונו גולמי באמצעות ffmpeg
    const ff = spawn("ffmpeg", [
        "-hide_banner",
        "-loglevel", "error",
        "-i", "pipe:0",
        "-acodec", "pcm_mulaw",
        "-ar", "8000",
        "-ac", "1",
        "-f", "mulaw",
        "pipe:1",
    ]);
    ff.on("error", (e) => console.error("[ffmpeg spawn error]", e));
    ff.stdin.on("error", (e) => console.error("[ffmpeg stdin error]", e));
    ff.stderr.on("data", (d) => console.error("[ffmpeg]", d.toString()));
    // חשוב: המרה מ-ReadableStream של web ל-Node stream
    Readable.fromWeb(res.body).pipe(ff.stdin);
    // נצבור שאריות כדי לפרק בדיוק ל-160 בייט
    let carry = Buffer.alloc(0);
    let seq = 0;
    let outFrames = 0;
    ff.stdout.on("data", (chunk) => {
        if (ws.readyState !== WebSocket.OPEN)
            return;
        const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
        let offset = 0;
        // Twilio מצפה ל-20ms פריים = 160 בייט @ 8kHz μ-law
        while (offset + 160 <= data.length) {
            const frame = data.subarray(offset, offset + 160);
            offset += 160;
            ws.send(JSON.stringify({
                event: "media",
                streamSid,
                sequenceNumber: String(++seq),
                media: { payload: frame.toString("base64") },
            }));
            outFrames++;
        }
        // שומרים שארית ל-chunk הבא
        carry = offset < data.length ? data.subarray(offset) : Buffer.alloc(0);
    });
    await new Promise((resolve) => {
        ff.once("close", () => {
            try {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        event: "mark",
                        streamSid,
                        mark: { name: "tts_end" },
                    }));
                }
            }
            catch { }
            console.log("[ffmpeg] closed. frames sent:", outFrames);
            resolve();
        });
    });
}
//# sourceMappingURL=elevenToTwilio.js.map