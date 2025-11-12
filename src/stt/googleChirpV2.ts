import { v2 as speech } from "@google-cloud/speech";

type V2Callbacks = {
  onData: (text: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
  onEnd?: () => void;
};

type V2Opts = {
  apiEndpoint?: string; // e.g. "us-central1-speech.googleapis.com"
  languageCode?: string; // default "he-IL"
  model?: string; // default "chirp"
  interimResults?: boolean; // default true
} & V2Callbacks;

export function createHebrewChirp3Stream(recognizer: string, opts: V2Opts) {
  const {
    apiEndpoint,
    languageCode = "he-IL",
    model = "chirp",
    interimResults = true,
    onData,
    onError,
    onEnd,
  } = opts;

  const client = new speech.SpeechClient(
    apiEndpoint ? { apiEndpoint } : undefined
  );

  // v2 requires: first write is streamingConfig; subsequent writes send { audio: Buffer }
  // Use explicitDecodingConfig for Twilio μ-law (8000 Hz, mono).
  const streamingConfig = {
    config: {
      languageCodes: [languageCode],
      model,
      // Choose explicit decoding for raw headerless audio:
      explicitDecodingConfig: {
        encoding: "MULAW",
        sampleRateHertz: 8000,
        audioChannelCount: 1,
      },
      // Enable punctuation (safe default). You can expose via env if you want.
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    streamingFeatures: {
      interimResults,
      // singleUtterance: false (default) → continuous stream; we handle EOU in higher layer
    },
  };

  let destroyed = false;

  const recognizeStream = client
    // Using the private streaming method works reliably with v2 per community reports.
    // See discussion: https://stackoverflow.com/q/76722471
    ._streamingRecognize()
    .on("data", (resp: any) => {
      try {
        if (!resp?.results?.length) return;
        for (const r of resp.results) {
          const alt = r.alternatives?.[0];
          if (!alt?.transcript) continue;
          onData(alt.transcript, !!r.isFinal);
        }
      } catch (e: any) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    })
    .on("error", (err: any) => {
      destroyed = true;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    })
    .on("end", () => {
      destroyed = true;
      onEnd?.();
    });

  // Send the initial config write
  recognizeStream.write({
    recognizer,
    streamingConfig,
  });

  function writeMuLawBase64(b64: string) {
    if (destroyed) return;
    try {
      const ulaw = Buffer.from(b64, "base64");
      // Send raw μ-law bytes; v2 will decode per explicitDecodingConfig
      recognizeStream.write({ audio: ulaw });
    } catch (e: any) {
      destroyed = true;
      onError?.(e instanceof Error ? e : new Error(String(e)));
      try {
        recognizeStream.end();
      } catch {}
    }
  }

  function end() {
    if (destroyed) return;
    destroyed = true;
    try {
      recognizeStream.end();
    } catch {}
  }

  return { writeMuLawBase64, end };
}