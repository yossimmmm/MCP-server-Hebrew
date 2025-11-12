import { v2 as speechV2 } from "@google-cloud/speech";
import { Buffer } from "node:buffer";
const client = new speechV2.SpeechClient();
// μ-law → PCM16 conversion (table-based, fast enough for telephony)
const MU_LAW_EXP_TABLE = (() => {
    const table = new Int16Array(256);
    const BIAS = 0x84;
    for (let i = 0; i < 256; i++) {
        const u = ~i & 0xff;
        let t = ((u & 0x0f) << 3) + BIAS;
        t <<= ((u & 0x70) >> 4) + 2;
        table[i] = (u & 0x80) ? (BIAS - t) : (t - BIAS);
    }
    return table;
})();
export function mulawToPcm16(mulaw) {
    const out = Buffer.allocUnsafe(mulaw.length * 2);
    for (let i = 0; i < mulaw.length; i++) {
        const s = MU_LAW_EXP_TABLE[mulaw[i]];
        out.writeInt16LE(s, i * 2);
    }
    return out;
}
export function createHebrewChirp3Stream(recognizerPath, // "projects/<PROJECT>/locations/global/recognizers/hebrew-reco"
handlers = {}) {
    const stream = client.streamingRecognize();
    stream.on("data", (resp) => {
        try {
            const results = resp?.results ?? [];
            for (const r of results) {
                const alt = r?.alternatives?.[0];
                if (!alt)
                    continue;
                const text = String(alt.transcript ?? "");
                const isFinal = Boolean(r.isFinal ?? r?.result?.isFinal);
                handlers.onData?.(text, isFinal, resp);
            }
        }
        catch (e) {
            handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
    });
    stream.on("error", (e) => handlers.onError?.(e instanceof Error ? e : new Error(String(e))));
    stream.on("end", () => handlers.onEnd?.());
    // Initial config packet
    stream.write({
        recognizer: recognizerPath,
        config: {
            autoDecodingConfig: {}, // we're sending PCM16 8k after μ-law decode
            features: { enableAutomaticPunctuation: true },
            model: "chirp_3",
            languageCodes: ["he-IL"],
            // singleUtterance: false
        },
    });
    return {
        writeMuLawBase64: (b64) => {
            try {
                const mulaw = Buffer.from(b64, "base64");
                const pcm16 = mulawToPcm16(mulaw);
                // Some lib versions expect {audioPacket:{data}}, others {audio:{content}}
                stream.write({ audioPacket: { data: pcm16 } });
                // If you see "Unrecognized field audioPacket", switch to:
                // stream.write({ audio: { content: pcm16 } } as any);
            }
            catch (e) {
                handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
            }
        },
        end: () => stream.end(),
    };
}
