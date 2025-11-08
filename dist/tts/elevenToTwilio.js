// src/tts/elevenToTwilio.ts
import { Readable } from "stream";
import { spawn } from "child_process";
const XI_API = "https://api.elevenlabs.io/v1";
export async function speakElevenToTwilio(args) {
    const { ws, streamSid, text, voiceId, speed = 1.0, model = "eleven_v3" } = args;
    if (!process.env.ELEVENLABS_API_KEY)
        throw new Error("ELEVENLABS_API_KEY not set");
    if (!voiceId)
        throw new Error("missing voiceId");
    // בקשת סטרים MP3 מ-ElevenLabs v3
    const url = `${XI_API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;
    const body = {
        text,
        model_id: model,
        output_format: "mp3_44100_128",
        language_code: "he"
    };
    if (speed !== 1.0)
        body.voice_settings = { speed };
    const upstream = await fetch(url, {
        method: "POST",
        headers: {
            "xi-api-key": process.env.ELEVENLABS_API_KEY,
            "content-type": "application/json",
            "accept": "audio/mpeg"
        },
        body: JSON.stringify(body)
    });
    if (!upstream.ok || !upstream.body) {
        const msg = await upstream.text().catch(() => upstream.statusText);
        throw new Error(`XI upstream error ${upstream.status} ${msg}`);
    }
    // ffmpeg: mp3 -> μ-law 8k (raw)
    const ff = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "mp3",
        "-i", "pipe:0",
        "-ac", "1",
        "-ar", "8000",
        "-f", "mulaw",
        "-acodec", "pcm_mulaw",
        "pipe:1"
    ], { stdio: ["pipe", "pipe", "inherit"] });
    // העבר את הסטרים מה-fetch ל-ffmpeg stdin
    Readable.fromWeb(upstream.body).pipe(ff.stdin);
    // Twilio מצפה מסגרות של ~20ms → 160 בייטים (8kHz, μ-law = 1 byte לדגימה)
    const FRAME_BYTES = 160;
    let carry = Buffer.alloc(0);
    await new Promise((resolve, reject) => {
        ff.stdout.on("data", (chunk) => {
            carry = Buffer.concat([carry, chunk]);
            while (carry.length >= FRAME_BYTES) {
                const frame = carry.subarray(0, FRAME_BYTES);
                carry = carry.subarray(FRAME_BYTES);
                const payloadB64 = frame.toString("base64");
                try {
                    ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: payloadB64 } }));
                }
                catch (e) {
                    // אם ה-WS נסגר — להפסיק
                    ff.kill("SIGKILL");
                    reject(e);
                    return;
                }
            }
        });
        ff.on("close", () => {
            // נשלח CLEAR לוודא שאין זנבות ברינג באפר בצד Twilio
            try {
                ws.send(JSON.stringify({ event: "clear", streamSid }));
            }
            catch { }
            resolve();
        });
        ff.on("error", reject);
    });
}
