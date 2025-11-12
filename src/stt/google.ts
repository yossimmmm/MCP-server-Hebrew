// src/stt/google.ts
import fs from "fs";
import { Writable } from "node:stream";
import { SpeechClient } from "@google-cloud/speech";

/** ייצור לקוח עם קרדנטים מהקובץ, כולל תיקון \n במפתח */
function makeSpeechClient(): SpeechClient {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && fs.existsSync(credPath)) {
    try {
      const raw = fs.readFileSync(credPath, "utf8");
      const j = JSON.parse(raw);
      const private_key = String(j.private_key || "").replace(/\\n/g, "\n");
      const client_email = String(j.client_email || "");
      const projectId = String(j.project_id || "");
      if (!private_key || !client_email) {
        console.warn("[STT] missing private_key/client_email in creds JSON, falling back to ADC");
        return new SpeechClient();
      }
      return new SpeechClient({
        projectId,
        credentials: { client_email, private_key },
      });
    } catch (e) {
      console.error("[STT] failed reading creds JSON, falling back to ADC:", (e as any)?.message || e);
      return new SpeechClient();
    }
  }
  // ADC (metadata server / gcloud auth application-default login)
  return new SpeechClient();
}

type Callbacks = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
};

export class GoogleSttSession {
  private client: SpeechClient;
  private audioIn: Writable | null = null;
  private closed = false;
  private cb: Callbacks;

  constructor(cb: Callbacks = {}) {
    this.cb = cb;
    this.client = makeSpeechClient();

    const languageCode = process.env.STT_LANGUAGE_CODE || "he-IL";

    const request = {
      config: {
        encoding: "LINEAR16" as const,
        sampleRateHertz: 8000,
        languageCode,
        enableAutomaticPunctuation: true,
      },
      interimResults: true,
    };

    const recognizeStream = this.client
      .streamingRecognize(request as any)
      .on("error", (e: any) => {
        this.closed = true;
        console.error("STT stream error:", e?.message || e);
      })
      .on("end", () => {
        this.closed = true;
        // console.log("[STT] stream ended");
      })
      .on("data", (data: any) => {
        try {
          if (!data || !data.results || !data.results.length) return;
          for (const r of data.results) {
            const alt = r.alternatives?.[0];
            if (!alt?.transcript) continue;
            if (r.isFinal) {
              this.cb.onFinal?.(alt.transcript);
              // console.log("[STT final]", alt.transcript);
            } else {
              this.cb.onPartial?.(alt.transcript);
              // console.log("[STT partial]", alt.transcript);
            }
          }
        } catch (err) {
          console.error("STT data handler error:", (err as any)?.message || err);
        }
      });

    this.audioIn = recognizeStream as unknown as Writable;
    // console.log("[STT] streaming session opened (he-IL, 8kHz, LINEAR16)");
  }

  /** ממשק הישן: קלט μ-law ב-base64 → המרה ל-PCM16 8kHz ושליחה לגוגל */
  writeMuLaw(b64: string): boolean {
    if (!this.audioIn || this.closed) return false;
    const s: any = this.audioIn;
    if (s.destroyed || s.writableEnded || s.writableFinished) return false;

    try {
      const ulaw = Buffer.from(b64, "base64");
      const pcm16 = muLawToLinear16(ulaw);
      return this.audioIn.write(pcm16);
    } catch (e) {
      console.error("STT error in writeMuLaw:", (e as any)?.message || e);
      return false;
    }
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    try { this.audioIn?.end(); } catch {}
    this.audioIn = null;
  }
}

export function createGoogleSession(cb?: Callbacks): GoogleSttSession {
  return new GoogleSttSession(cb);
}

/** μ-law → PCM16LE (8kHz) */
function muLawToLinear16(input: Buffer): Buffer {
  const out = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const s = ulawDecodeSample(input[i] & 0xff);
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

function ulawDecodeSample(uVal: number): number {
  uVal = ~uVal & 0xff;
  const sign = (uVal & 0x80) ? -1 : 1;
  const exponent = (uVal >> 4) & 0x07;
  const mantissa = uVal & 0x0F;
  const sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign * sample;
}
