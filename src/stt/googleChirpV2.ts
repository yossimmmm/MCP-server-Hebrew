import speech from '@google-cloud/speech';
import { Buffer } from 'node:buffer';

export type SttHandlers = {
  onData?: (finalText: string, isFinal: boolean, raw: any) => void;
  onError?: (err: Error) => void;
  onEnd?: () => void;
};

const client = new speech.v2.SpeechClient({
  apiEndpoint: 'us-central1-speech.googleapis.com',
});

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

export function mulawToPcm16(mulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    const s = MU_LAW_EXP_TABLE[mulaw[i]];
    out.writeInt16LE(s, i * 2);
  }
  return out;
}

export type SttStream = {
  writeMuLawBase64: (b64: string) => void;
  end: () => void;
};

export function createHebrewChirp3Stream(
  recognizerPath: string,
  handlers: SttHandlers = {}
): SttStream {
  const stream = client.streamingRecognize();

  stream.on('data', (resp: any) => {
    try {
      const results: any[] = resp?.results ?? [];
      for (const r of results) {
        const alt = r?.alternatives?.[0];
        if (!alt) continue;
        const text = String(alt.transcript ?? '');
        const isFinal = Boolean(r.isFinal ?? r?.result?.isFinal);
        handlers.onData?.(text, isFinal, resp);
      }
    } catch (e: any) {
      handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  });

  stream.on('error', (e: any) =>
    handlers.onError?.(e instanceof Error ? e : new Error(String(e)))
  );
  stream.on('end', () => handlers.onEnd?.());

  // Initial config packet (must be first write)
  stream.write({
    recognizer: recognizerPath,
    config: {
      autoDecodingConfig: {},
      features: { enableAutomaticPunctuation: true },
      model: 'chirp_3',
      languageCodes: ['he-IL'],
    },
  } as any);

  return {
    writeMuLawBase64: (b64: string) => {
      try {
        const mulaw = Buffer.from(b64, 'base64');
        const pcm16 = mulawToPcm16(mulaw);
        stream.write({ audio: { content: pcm16 } } as any);
        // If you see “Unrecognized field audio”, switch to:
        // stream.write({ audioPacket: { data: pcm16 } } as any);
      } catch (e: any) {
        handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    },
    end: () => stream.end(),
  };
}