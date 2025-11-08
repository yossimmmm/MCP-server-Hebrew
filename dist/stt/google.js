// src/stt/google.ts
import { SpeechClient } from "@google-cloud/speech";
export function createGoogleStt(opts) {
    const client = new SpeechClient();
    let recognizeStream = null;
    function start() {
        if (recognizeStream)
            return;
        recognizeStream = client
            .streamingRecognize({
            config: {
                encoding: "MULAW", // קולט ישירות μ-law מטוויליו
                sampleRateHertz: opts.sampleRateHertz,
                languageCode: opts.languageCode,
                enableAutomaticPunctuation: true,
                model: "phone_call"
            },
            interimResults: true
        })
            .on("error", (e) => opts.onError?.(e))
            .on("data", (data) => {
            const alt = data.results?.[0]?.alternatives?.[0];
            if (!alt?.transcript)
                return;
            if (data.results[0].isFinal) {
                opts.onFinal(alt.transcript);
            }
            else {
                opts.onPartial(alt.transcript);
            }
        })
            .on("end", () => {
            recognizeStream = null;
            opts.onEnd?.();
        });
    }
    function writeMuLaw(chunk) {
        if (!recognizeStream)
            return;
        recognizeStream.write({ audio_content: chunk });
    }
    function stop() {
        try {
            recognizeStream?.end();
        }
        catch { }
        recognizeStream = null;
    }
    return { start, writeMuLaw, stop };
}
