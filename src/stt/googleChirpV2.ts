// src/stt/googleChirpV2.ts
import { v2 as speech } from "@google-cloud/speech";
import { createFinalDeduper } from "../sttDedup.js";

type V2Callbacks = {
  onData: (text: string, isFinal: boolean) => void;
  onError?: (err: Error) => void;
  onEnd?: () => void;
};

type V2Opts = {
  apiEndpoint?: string;
  languageCode?: string;
  interimResults?: boolean;
} & V2Callbacks;

export function createHebrewChirp3Stream(recognizer: string, opts: V2Opts) {
  const {
    apiEndpoint = process.env.SPEECH_V2_ENDPOINT,
    languageCode = process.env.STT_LANGUAGE_CODE || "iw-IL",
    interimResults = true,
    onData,
    onError,
    onEnd,
  } = opts;

  const client = new speech.SpeechClient(
    apiEndpoint ? { apiEndpoint } : undefined
  );

  const eouMs = Number(process.env.STT_EOU_MS || "750");
  const eouGuardMs = Number(process.env.STT_EOU_GUARD_MS || "500");
  const minPartialChars = Number(process.env.STT_MIN_PARTIAL_CHARS || "3");
  const dedupWindowMs = Number(process.env.STT_DEDUP_WINDOW_MS || "1800");
  const acceptFinal = createFinalDeduper(dedupWindowMs);

  let lastPartial = "";
  let lastPartialAt = 0;
  let lastGoogleFinalAt = 0;
  let eouTimer: NodeJS.Timeout | null = null;

  const scheduleEOU = () => {
    if (!eouMs) return;
    if (eouTimer) clearTimeout(eouTimer);
    if (
      !lastPartial ||
      lastPartial.replace(/\s/g, "").length < minPartialChars
    ) {
      return;
    }

    eouTimer = setTimeout(() => {
      const t = lastPartial;
      lastPartial = "";

      if (Date.now() - lastGoogleFinalAt < eouGuardMs) {
        console.log("[STT v2 final eou] suppressed (recent Google final)");
        return;
      }

      if (t && acceptFinal(t)) {
        console.log("[STT v2 final eou]", t);
        onData(t, true);
      }
    }, eouMs);
  };

  const clearEOU = () => {
    if (eouTimer) clearTimeout(eouTimer);
    eouTimer = null;
    lastPartial = "";
    lastPartialAt = 0;
  };

  const streamingConfig = {
    config: {
      languageCodes: [languageCode],
      model: "chirp_3",
      explicitDecodingConfig: {
        encoding: "MULAW",
        sampleRateHertz: 8000,
        audioChannelCount: 1,
      },
      features: {
        enableAutomaticPunctuation: true,
      },
    },
    streamingFeatures: {
      interimResults,
    },
  };

  let destroyed = false;

  const recognizeStream = client
    ._streamingRecognize()
    .on("data", (resp: any) => {
      try {
        if (!resp?.results?.length) return;
        for (const r of resp.results) {
          const alt = r.alternatives?.[0];
          if (!alt?.transcript) continue;

          if (r.isFinal) {
            const t = alt.transcript;
            clearEOU();
            lastGoogleFinalAt = Date.now();
            if (acceptFinal(t)) {
              console.log("[STT v2 final]", t);
              onData(t, true);
            } else {
              console.log("[STT v2 final dup] dropped");
            }
          } else {
            lastPartial = alt.transcript;
            lastPartialAt = Date.now();
            const len = lastPartial.replace(/\s/g, "").length;
            console.log(
              "[STT v2 partial]",
              lastPartial,
              "| nonSpaceLen=",
              len,
              "| minPartialChars=",
              minPartialChars
            );
            onData(lastPartial, false);
            scheduleEOU();
          }
        }
      } catch (e: any) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    })
    .on("error", (err: any) => {
      destroyed = true;
      console.error("[STT v2 error]", err?.message || err);
      if (lastPartial) {
        const t = lastPartial;
        clearEOU();
        if (acceptFinal(t)) {
          console.log("[STT v2 final on error]", t);
          onData(t, true);
        }
      }
      onError?.(err instanceof Error ? err : new Error(String(err)));
    })
    .on("end", () => {
      destroyed = true;
      if (lastPartial) {
        const t = lastPartial;
        clearEOU();
        if (acceptFinal(t)) {
          console.log("[STT v2 final on end]", t);
          onData(t, true);
        }
      }
      onEnd?.();
    });

  recognizeStream.write({
    recognizer,
    streamingConfig,
  });

  function writeMuLawBase64(b64: string) {
    if (destroyed) return;
    try {
      const ulaw = Buffer.from(b64, "base64");
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
