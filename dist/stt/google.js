// src/stt/google.ts
import fs from "fs";
import { createPrivateKey } from "node:crypto";
import { SpeechClient } from "@google-cloud/speech";
import { createFinalDeduper } from "../sttDedup.js";
function makeSpeechClient() {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    // Preferred: let the Google SDK read the JSON key file directly
    if (credPath && fs.existsSync(credPath)) {
        console.log("[STT] Using key file:", credPath);
        return new SpeechClient({ keyFilename: credPath });
    }
    // Optional: support passing the JSON via env (plain or base64)
    const rawJson = process.env.GOOGLE_CREDENTIALS_JSON ||
        (process.env.GOOGLE_CREDENTIALS_B64
            ? Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, "base64").toString("utf8")
            : undefined);
    if (rawJson) {
        const c = JSON.parse(rawJson);
        const private_key = String(c.private_key || "");
        const client_email = String(c.client_email || "");
        const project_id = String(c.project_id || "");
        // Normalize only line endings; do NOT rewrap/trim the PEM content
        const pem = private_key.replace(/\r\n/g, "\n").replace(/\\n/g, "\n");
        // Validate early so we throw a clear error instead of gRPC’s DECODER message
        try {
            createPrivateKey({ key: pem, format: "pem" });
        }
        catch (e) {
            throw new Error(`[STT] Invalid private_key in credentials: ${e?.message || e}`);
        }
        console.log("[STT] Using credentials from GOOGLE_CREDENTIALS_* env");
        return new SpeechClient({
            projectId: project_id || undefined,
            credentials: { client_email, private_key: pem },
        });
    }
    console.warn("[STT] No explicit credentials found; falling back to ADC");
    return new SpeechClient();
}
export class GoogleSttSession {
    client;
    audioIn = null;
    closed = false;
    cb;
    acceptFinal;
    constructor(cb = {}) {
        this.cb = cb;
        this.client = makeSpeechClient();
        const dedupMs = Number(process.env.STT_DEDUP_WINDOW_MS || "1800");
        this.acceptFinal = createFinalDeduper(dedupMs);
        const languageCode = process.env.STT_LANGUAGE_CODE || "he-IL";
        const request = {
            config: {
                encoding: "LINEAR16",
                sampleRateHertz: 8000,
                languageCode,
                enableAutomaticPunctuation: true,
            },
            interimResults: true,
        };
        try {
            const recognizeStream = this.client
                .streamingRecognize(request)
                .on("error", (e) => {
                this.closed = true;
                const msg = e?.message || String(e);
                console.error("[STT stream error]", msg);
                if (/DECODER|PEM|private key|metadata from plugin/i.test(msg)) {
                    console.error("[STT] Your service-account private_key is malformed or unreadable.\n" +
                        "Fix: point GOOGLE_APPLICATION_CREDENTIALS to the raw JSON you downloaded from GCP\n" +
                        "(IAM & Admin → Service Accounts → <your SA> → Keys → Add key → Create new key → JSON),\n" +
                        "or set GOOGLE_CREDENTIALS_B64/GOOGLE_CREDENTIALS_JSON. Do not reformat the PEM.");
                }
            })
                .on("end", () => {
                this.closed = true;
            })
                .on("data", (data) => {
                try {
                    if (!data?.results?.length)
                        return;
                    for (const r of data.results) {
                        const alt = r.alternatives?.[0];
                        if (!alt?.transcript)
                            continue;
                        if (r.isFinal) {
                            const t = alt.transcript;
                            if (this.acceptFinal(t)) {
                                this.cb.onFinal?.(t);
                                console.log("[STT final]", t);
                            }
                            else {
                                console.log("[STT final dup] dropped");
                            }
                        }
                        else {
                            this.cb.onPartial?.(alt.transcript);
                        }
                    }
                }
                catch (err) {
                    console.error("[STT data handler error]", err?.message || err);
                }
            });
            this.audioIn = recognizeStream;
            console.log(`[STT] Session opened (${languageCode}, 8kHz LINEAR16)`);
        }
        catch (e) {
            console.error("[STT] Failed to create recognize stream:", e?.message || e);
            this.closed = true;
        }
    }
    // Feed a single 20ms μ-law frame (base64) from Twilio; converts to PCM16 for Google STT
    writeMuLaw(b64) {
        if (!this.audioIn || this.closed)
            return false;
        const s = this.audioIn;
        if (s.destroyed || s.writableEnded || s.writableFinished)
            return false;
        try {
            const ulaw = Buffer.from(b64, "base64");
            const pcm16 = muLawToLinear16(ulaw);
            return this.audioIn.write(pcm16);
        }
        catch (e) {
            console.error("[STT writeMuLaw error]", e?.message || e);
            return false;
        }
    }
    end() {
        if (this.closed)
            return;
        this.closed = true;
        try {
            this.audioIn?.end();
        }
        catch (e) {
            console.error("[STT end error]", e?.message || e);
        }
        this.audioIn = null;
    }
}
export function createGoogleSession(cb) {
    return new GoogleSttSession(cb);
}
// Helpers: μ-law (G.711) → PCM16 (LE)
function muLawToLinear16(input) {
    const out = Buffer.allocUnsafe(input.length * 2);
    for (let i = 0; i < input.length; i++) {
        const sample = ulawDecodeSample(input[i] & 0xff);
        out.writeInt16LE(sample, i * 2);
    }
    return out;
}
function ulawDecodeSample(uVal) {
    uVal = ~uVal & 0xff;
    const sign = (uVal & 0x80) ? -1 : 1;
    const exponent = (uVal >> 4) & 0x07;
    const mantissa = uVal & 0x0f;
    const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    return sign * sample;
}
//# sourceMappingURL=google.js.map