// src/stt/google.ts
import fs from "fs";
import { createPrivateKey } from "node:crypto";
import { Writable } from "node:stream";
import { SpeechClient } from "@google-cloud/speech";
import { createFinalDeduper } from "../sttDedup.js";

function makeSpeechClient(): SpeechClient {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  // Preferred: let the Google SDK read the JSON key file directly
  if (credPath && fs.existsSync(credPath)) {
    console.log("[STT] Using key file:", credPath);
    return new SpeechClient({ keyFilename: credPath });
  }

  // Optional: support passing the JSON via env (plain or base64)
  const rawJson =
    process.env.GOOGLE_CREDENTIALS_JSON ||
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
    } catch (e: any) {
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

export type Callbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
};

export class GoogleSttSession {
  private client: SpeechClient;
  private audioIn: Writable | null = null;
  private closed = false;
  private cb: Callbacks;
  private acceptFinal: (t: string) => boolean;

  // EOU logic
  private eouMs = Number(process.env.STT_EOU_MS || "750");
  private eouGuardMs = Number(process.env.STT_EOU_GUARD_MS || "500");
  private minPartialChars = Number(process.env.STT_MIN_PARTIAL_CHARS || "3");
  private lastPartial = "";
  private lastPartialAt = 0;
  private eouTimer: NodeJS.Timeout | null = null;
  private lastGoogleFinalAt = 0;

  private scheduleEOU = () => {
    if (!this.eouMs) return;
    if (this.eouTimer) clearTimeout(this.eouTimer);
    if (!this.lastPartial || this.lastPartial.replace(/\s/g, "").length < this.minPartialChars) {
      return;
    }

    this.eouTimer = setTimeout(() => {
      const t = this.lastPartial;
      this.lastPartial = "";

      // Drop EOU if a Google final just arrived (race guard)
      if (Date.now() - this.lastGoogleFinalAt < this.eouGuardMs) {
        console.log("[STT final eou] suppressed (recent Google final)");
        return;
      }
      if (t && this.acceptFinal(t)) {
        this.cb.onFinal?.(t);
        console.log("[STT final eou]", t);
      }
    }, this.eouMs);
  };

  private clearEOU = () => {
    if (this.eouTimer) clearTimeout(this.eouTimer);
    this.eouTimer = null;
    this.lastPartial = "";
    this.lastPartialAt = 0;
  };

  constructor(cb: Callbacks = {}) {
    this.cb = cb;
    this.client = makeSpeechClient();
    const dedupMs = Number(process.env.STT_DEDUP_WINDOW_MS || "1800");
    this.acceptFinal = createFinalDeduper(dedupMs);

    const languageCode = process.env.STT_LANGUAGE_CODE || "he-IL";

    // Optional model tuning/envs (safe defaults)
    const enablePunc =
      String(process.env.STT_PUNCTUATION ?? "true").toLowerCase() !== "false";
    const useEnhanced =
      String(process.env.STT_USE_ENHANCED ?? "false").toLowerCase() === "true";
const model = undefined;
    const speechContexts = process.env.STT_HINTS
      ? [
          {
            phrases: process.env.STT_HINTS.split("|")
              .map((s) => s.trim())
              .filter(Boolean),
          },
        ]
      : undefined;

    const request = {
  config: {
    encoding: "LINEAR16" as const,
    sampleRateHertz: 8000,
    languageCode,
    enableAutomaticPunctuation: enablePunc,
    speechContexts,
    audioChannelCount: 1,
  },
  interimResults: true,
};

    try {
      const recognizeStream = this.client
        .streamingRecognize(request as any)
        .on("error", (e: any) => {
          this.closed = true;
          const msg = e?.message || String(e);
          console.error("[STT stream error]", msg);

          if (/DECODER|PEM|private key|metadata from plugin/i.test(msg)) {
            console.error(
              "[STT] Your service-account private_key is malformed or unreadable.\n" +
                "Fix: point GOOGLE_APPLICATION_CREDENTIALS to the raw JSON you downloaded from GCP\n" +
                "(IAM & Admin → Service Accounts → <your SA> → Keys → Add key → Create new key → JSON),\n" +
                "or set GOOGLE_CREDENTIALS_B64/GOOGLE_CREDENTIALS_JSON. Do not reformat the PEM."
            );
          }

          // Flush last partial as best-effort final if the stream errors
          if (this.lastPartial) {
            const t = this.lastPartial;
            this.clearEOU();
            if (this.acceptFinal(t)) this.cb.onFinal?.(t);
          }
        })
        .on("end", () => {
          this.closed = true;
          // Flush last partial if stream closes
          if (this.lastPartial) {
            const t = this.lastPartial;
            this.clearEOU();
            if (this.acceptFinal(t)) this.cb.onFinal?.(t);
          }
        })
        .on("data", (data: any) => {
          try {
            if (!data?.results?.length) return;

            for (const r of data.results) {
              const alt = r.alternatives?.[0];
              if (!alt?.transcript) continue;

              if (r.isFinal) {
                const t = alt.transcript;
                this.clearEOU();
                this.lastGoogleFinalAt = Date.now();
                if (this.acceptFinal(t)) {
                  this.cb.onFinal?.(t);
                  console.log("[STT final]", t);
                } else {
                  console.log("[STT final dup] dropped");
                }
              } else {
                // INTERIM
                this.lastPartial = alt.transcript;
                this.lastPartialAt = Date.now();
                this.cb.onPartial?.(this.lastPartial);
                this.scheduleEOU();
              }
            }
          } catch (err: any) {
            console.error("[STT data handler error]", err?.message || err);
          }
        });

      this.audioIn = recognizeStream as unknown as Writable;
      console.log(`[STT] Session opened (${languageCode}, 8kHz LINEAR16)`);
    } catch (e: any) {
      console.error("[STT] Failed to create recognize stream:", e?.message || e);
      this.closed = true;
    }
  }

  // Feed a single 20ms μ-law frame (base64) from Twilio; converts to PCM16 for Google STT
  writeMuLaw(b64: string): boolean {
    if (!this.audioIn || this.closed) return false;
    const s: any = this.audioIn;
    if (s.destroyed || s.writableEnded || s.writableFinished) return false;

    try {
      const ulaw = Buffer.from(b64, "base64");
      const pcm16 = muLawToLinear16(ulaw);
      return this.audioIn.write(pcm16);
    } catch (e: any) {
      console.error("[STT writeMuLaw error]", e?.message || e);
      return false;
    }
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.audioIn?.end();
    } catch (e: any) {
      console.error("[STT end error]", e?.message || e);
    }
    this.audioIn = null;
    this.clearEOU();
  }
}

export function createGoogleSession(cb?: Callbacks): GoogleSttSession {
  return new GoogleSttSession(cb);
}

// Helpers: μ-law (G.711) → PCM16 (LE)
function muLawToLinear16(input: Buffer): Buffer {
  const out = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const sample = ulawDecodeSample(input[i] & 0xff);
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

function ulawDecodeSample(uVal: number): number {
  uVal = ~uVal & 0xff;
  const sign = (uVal & 0x80) ? -1 : 1;
  const exponent = (uVal >> 4) & 0x07;
  const mantissa = uVal & 0x0f;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign * sample;
}