// src/stt/google.ts
import { SpeechClient } from "@google-cloud/speech";

type SttOpts = {
  languageCode: string;                // "he-IL"
  sampleRateHertz: number;             // 8000
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (err: any) => void;
  onEnd?: () => void;
};

export function createGoogleStt(opts: SttOpts) {
  const client = new SpeechClient();
  let recognizeStream: any | null = null;

  function start() {
    if (recognizeStream) return;
    recognizeStream = client
      .streamingRecognize({
        config: {
          encoding: "MULAW",           // קולט ישירות μ-law מטוויליו
          sampleRateHertz: opts.sampleRateHertz,
          languageCode: opts.languageCode,
          enableAutomaticPunctuation: true,
          model: "phone_call"
        },
        interimResults: true
      })
      .on("error", (e: any) => opts.onError?.(e))
      .on("data", (data: any) => {
        const alt = data.results?.[0]?.alternatives?.[0];
        if (!alt?.transcript) return;
        if (data.results[0].isFinal) {
          opts.onFinal(alt.transcript);
        } else {
          opts.onPartial(alt.transcript);
        }
      })
      .on("end", () => {
        recognizeStream = null;
        opts.onEnd?.();
      });
  }

  function writeMuLaw(chunk: Buffer) {
    if (!recognizeStream) return;
    recognizeStream.write({ audio_content: chunk });
  }

  function stop() {
    try { recognizeStream?.end(); } catch {}
    recognizeStream = null;
  }

  return { start, writeMuLaw, stop };
}
