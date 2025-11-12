import speech from "@google-cloud/speech";
const { v1p1beta1: speechV1 } = speech;
const client = new speechV1.SpeechClient();
export class GoogleSttSession {
    audioIn;
    closed = false;
    constructor() {
        const request = {
            config: {
                encoding: "LINEAR16",
                sampleRateHertz: 8000,
                languageCode: "he-IL",
                enableAutomaticPunctuation: true,
            },
            interimResults: true,
        };
        const recognizeStream = client
            .streamingRecognize(request)
            .on("error", (e) => {
            this.closed = true;
            console.error("STT stream error:", e?.message || e);
        })
            .on("end", () => { this.closed = true; });
        this.audioIn = recognizeStream;
    }
    writeMuLaw(b64) {
        if (!this.audioIn || this.closed)
            return false;
        const a = this.audioIn;
        if (a.destroyed || a.writableEnded || a.writableFinished)
            return false;
        try {
            const ulaw = Buffer.from(b64, "base64");
            const pcm16 = muLawToLinear16(ulaw);
            return this.audioIn.write(pcm16);
        }
        catch (e) {
            console.error("STT error in writeMuLaw:", e?.message || e);
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
        catch { }
        this.audioIn = null;
    }
}
export function createGoogleSession() {
    return new GoogleSttSession();
}
function muLawToLinear16(input) {
    const out = Buffer.allocUnsafe(input.length * 2);
    for (let i = 0; i < input.length; i++) {
        const s = ulawDecodeSample(input[i]);
        out.writeInt16LE(s, i * 2);
    }
    return out;
}
function ulawDecodeSample(uVal) {
    uVal = ~uVal & 0xff;
    const sign = (uVal & 0x80) ? -1 : 1;
    const exponent = (uVal >> 4) & 0x07;
    const mantissa = uVal & 0x0F;
    const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    return sign * sample;
}
//# sourceMappingURL=google.js.map