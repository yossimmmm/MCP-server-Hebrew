// src/telephony/wsTwilio.ts
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { performance } from "node:perf_hooks";
import { createGoogleSession } from "../stt/google.js";
import { createHebrewChirp3Stream } from "../stt/googleChirpV2.js";
import { LlmSession } from "../nlu/gemini.js";
import TtsQueue from "../tts/ttsQueue.js";

// Normalized barge-in threshold: clamp between 3 and 5 characters
const RAW_BARGE_IN_MIN_CHARS = Number(process.env.BARGE_IN_MIN_CHARS || "5");
const BARGE_IN_MIN_CHARS =
  Number.isFinite(RAW_BARGE_IN_MIN_CHARS)
    ? Math.max(3, Math.min(RAW_BARGE_IN_MIN_CHARS, 5))
    : 3;

const TTS_START_FRAMES = Number(process.env.TTS_START_FRAMES || "10");

// PACER_MS takes TTS_PACER_MS or PACER_MS
const PACER_MS = Number(
  process.env.TTS_PACER_MS || process.env.PACER_MS || "20"
);
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "eleven_v3";
const DEFAULT_LANG = process.env.TTS_LANGUAGE_CODE || "he";
const CALL_GREETING = process.env.CALL_GREETING || "";

// How long to wait for a preview before falling back to full call (ms)
const LLM_PREVIEW_WAIT_MS = Number(
  process.env.LLM_PREVIEW_WAIT_MS || "300"
);

// Delay before playing waiting clips (ms)
const WAITING_DELAY_MS = Number(
  process.env.WAITING_DELAY_MS || "900"
);

// STT engine selector; default v1, unless STT_ENGINE=v2 and recognizer is valid
const STT_ENGINE = String(process.env.STT_ENGINE || "").toLowerCase(); // "v1" | "v2"
const V2_RECOGNIZER = process.env.GC_STT_RECOGNIZER || ""; // projects/{proj}/locations/{loc}/recognizers/{id}
const V2_API_ENDPOINT =
  process.env.GC_STT_API_ENDPOINT || deriveEndpointFromRecognizer(V2_RECOGNIZER);

function deriveEndpointFromRecognizer(recognizer: string): string | undefined {
  const m = recognizer.match(/\/locations\/([^/]+)/i);
  const loc = m?.[1];
  if (!loc || loc.toLowerCase() === "global") {
    return undefined; // use library default "speech.googleapis.com"
  }
  return `${loc}-speech.googleapis.com`;
}

// Map XI_* env into voice settings for Eleven v3
function envVoiceSettings() {
  const num = (k: string) =>
    process.env[k] != null ? Number(process.env[k]) : undefined;
  const bool = (k: string, def?: boolean) =>
    process.env[k] != null ? !/^(false|0)$/i.test(String(process.env[k])) : def;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const snap = (v: number, choices: number[]) =>
    choices.reduce(
      (a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a),
      choices[0]
    );

  const vs: any = {};

  const s = num("XI_STABILITY");
  if (s != null && !Number.isNaN(s)) {
    vs.stability = snap(s, [0, 0.5, 1]);
  }

  const sim = num("XI_SIMILARITY") ?? num("XI_SIMILARITY_BOOST");
  if (sim != null && !Number.isNaN(sim)) {
    vs.similarity_boost = clamp01(sim);
  }

  const style = num("XI_STYLE");
  if (style != null && !Number.isNaN(style)) {
    vs.style = clamp01(style);
  }

  const boost = bool("XI_SPEAKER_BOOST", false);
  if (boost && DEFAULT_MODEL === "eleven_v3") {
    vs.use_speaker_boost = true;
  }

  const rate = num("XI_SPEAKING_RATE");
  if (rate != null && !Number.isNaN(rate)) {
    vs.speaking_rate = rate;
  }

  return Object.keys(vs).length ? vs : undefined;
}

type TwilioMsg =
  | { event: "start"; start: { streamSid: string } }
  | { event: "media"; media: { payload: string } }
  | { event: "mark"; mark: { name: string } }
  | { event: "stop"; streamSid: string }
  | { event: string; [k: string]: any };

function now() {
  return new Date().toISOString();
}

// Text normalization for "close enough" comparison
function normalizeText(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[.,!?;:"'׳״()\-–—]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCloseEnough(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return false;
  return (
    na === nb ||
    na.startsWith(nb) ||
    nb.startsWith(na) ||
    na.includes(nb) ||
    nb.includes(na)
  );
}

export function attachTwilioWs(server: http.Server) {
  const wss = new WebSocketServer({ server, path: "/ws/twilio" });

  wss.on("connection", (ws, req) => {
    console.log(
      `[twilio][ws] connection opened ${now()} from ${req.socket.remoteAddress}`
    );

    let streamSid: string | undefined;
    let closed = false;

    const llm = new LlmSession();
    const seqRef = { value: 0 };

    const ttsQueue = new TtsQueue({
      ws: ws as WebSocket,
      getStreamSid: () => streamSid,
      sequenceRef: seqRef,
      modelId: DEFAULT_MODEL,
      languageCode: DEFAULT_LANG,
      startBufferFrames: TTS_START_FRAMES,
      pacerMs: PACER_MS,
      voiceSettings: envVoiceSettings(),
      defaultWaitDelayMs: WAITING_DELAY_MS > 0 ? WAITING_DELAY_MS : 0,
    });

    // === LLM preview state ===
    let latestUserText = "";
    let latestPreviewText = "";
    let latestPreviewReply = "";
    let llmInFlight: Promise<string> | null = null;

    // PARTIAL → start preview + barge-in
    function handlePartialText(text: string) {
      if (!text) return;
      latestUserText = text;

      const nonSpaceLen = text.replace(/\s/g, "").length;
      console.log(
        "[PARTIAL handle] text=",
        text,
        "| nonSpaceLen=",
        nonSpaceLen,
        "| threshold=",
        BARGE_IN_MIN_CHARS
      );

      if (nonSpaceLen < BARGE_IN_MIN_CHARS) {
        console.log(
          "[PARTIAL handle] below threshold → no barge-in, no preview yet"
        );
        return;
      }

      console.log(
        "[BARGE-IN] aborting current TTS because partial reached threshold"
      );
      ttsQueue.bargeIn();

      if (llmInFlight) {
        console.log(
          "[LLM preview] already in-flight, skipping another preview call"
        );
        return;
      }

      const previewInput = text;
      latestPreviewText = previewInput;
      console.log("[LLM preview] starting for partial:", previewInput);

      llmInFlight = (async () => {
        try {
          const t0 = performance.now();
          const reply = await llm.replyPreview(previewInput);
          const dt = Math.round(performance.now() - t0);
          console.log("[LLM preview done] ms=", dt, "reply=", reply);
          latestPreviewReply = reply;
          return reply;
        } catch (e: any) {
          console.error("[LLM preview error]", e?.message || e);
          return "";
        } finally {
          llmInFlight = null;
        }
      })();
    }

    // FINAL → use preview when possible, otherwise full call + waiting clip from previous turn
    async function handleFinalText(finalText: string) {
      const cleaned = (finalText || "").trim();
      if (!cleaned) return;
      console.log("[FINAL handle] text=", cleaned);

      const tryUsePreview = async (): Promise<string> => {
        // 1) If we already have a preview reply that clearly matches this final text → reuse immediately.
        if (latestPreviewReply && latestPreviewText) {
          if (isCloseEnough(cleaned, latestPreviewText)) {
            console.log("[LLM] using existing preview reply");
            return latestPreviewReply;
          }
        }

        // 2) If there's an in-flight preview and it *might* match this final text, wait up to LLM_PREVIEW_WAIT_MS.
        if (llmInFlight) {
          if (
            latestPreviewText &&
            isCloseEnough(cleaned, latestPreviewText)
          ) {
            console.log(
              "[LLM] waiting for in-flight preview up to",
              LLM_PREVIEW_WAIT_MS,
              "ms"
            );
            try {
              const result = await Promise.race<string>([
                llmInFlight,
                new Promise<string>((resolve) =>
                  setTimeout(() => resolve(""), LLM_PREVIEW_WAIT_MS)
                ),
              ]);

              if (
                result &&
                latestPreviewReply &&
                latestPreviewText &&
                isCloseEnough(cleaned, latestPreviewText)
              ) {
                console.log(
                  "[LLM] in-flight preview finished in time, using preview reply"
                );
                return latestPreviewReply;
              }
            } catch (e: any) {
              console.error(
                "[LLM] error while waiting for preview:",
                e?.message || e
              );
            }
          } else {
            // We know the final text diverged from the partial used for preview → no point waiting.
            console.log(
              "[LLM] in-flight preview text diverged from final text → skipping preview wait"
            );
          }
        }

        // 3) No usable preview → fall back to full replyFinal.
        return "";
      };

      let reply = await tryUsePreview();

      if (!reply) {
        // No preview ready/usable → play waiting clip from previous turn (if any) and run final LLM
        const clipId = llm.getPendingWaitingClipIdAndClear();
        if (clipId) {
          console.log("[WAIT] enqueuing waiting clip id from LLM:", clipId);
          ttsQueue.enqueueClip(clipId);
        }

        const t0 = performance.now();
        reply = await llm.replyFinal(cleaned);
        const dt = Math.round(performance.now() - t0);
        console.log("[LLM final ms]", dt);
      }

      if (!streamSid) return;
      ttsQueue.enqueueText(reply);
    }

    // === STT (v2 with fallback to v1) ===
    let sttWrite: (b64: string) => void = () => {};
    let sttEnd: () => void = () => {};
    let sttDead = false;

    const installV1 = (why?: string) => {
      sttDead = false;
      if (why) console.warn(`[STT] Switching to v1 because: ${why}`);

      const sttV1 = createGoogleSession({
        onPartial: (txt) => {
          console.log("[STT v1 partial]", txt);
          handlePartialText(txt);
        },
        onFinal: (finalText) => {
          console.log("[STT v1 final]", finalText);
          handleFinalText(finalText).catch((e) =>
            console.error("[LLM final v1 error]", e?.message || e)
          );
        },
      });

      sttWrite = (b64) => {
        if (!sttDead) sttV1.writeMuLaw(b64);
      };
      sttEnd = () => sttV1.end();
    };

    const installV2 = () => {
      sttDead = false;

      if (
        !V2_RECOGNIZER ||
        !/^projects\/[^/]+\/locations\/[^/]+\/recognizers\/[^/]+$/i.test(
          V2_RECOGNIZER
        )
      ) {
        installV1("invalid or missing GC_STT_RECOGNIZER");
        return;
      }

      const sttV2 = createHebrewChirp3Stream(V2_RECOGNIZER, {
        apiEndpoint: V2_API_ENDPOINT,
        languageCode: process.env.STT_LANGUAGE_CODE,
        interimResults: true,
        onData: (text, isFinal) => {
          console.log(
            isFinal ? "[STT v2 FINAL raw]" : "[STT v2 PARTIAL raw]",
            text
          );
          if (!text) return;

          if (isFinal) {
            handleFinalText(text).catch((e) =>
              console.error("[LLM final v2 error]", e?.message || e)
            );
          } else {
            handlePartialText(text);
          }
        },
        onError: (e) => {
          console.error("[STT v2 error]", e?.message || e);
          sttDead = true;
          installV1(e?.message || "v2 stream error");
        },
        onEnd: () => {
          console.log("[STT v2 end]");
          sttDead = true;
        },
      });

      sttWrite = (b64) => {
        if (!sttDead) sttV2.writeMuLawBase64(b64);
      };
      sttEnd = () => sttV2.end();
    };

    if (STT_ENGINE === "v2" && V2_RECOGNIZER) {
      installV2();
    } else {
      installV1(
        !V2_RECOGNIZER && STT_ENGINE === "v2"
          ? "GC_STT_RECOGNIZER not set"
          : undefined
      );
    }

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(String(data)) as TwilioMsg;

        switch (msg.event) {
          case "start":
            streamSid = msg.start?.streamSid;
            console.log(
              `[twilio] start streamSid=${streamSid} (BARGE_IN_MIN_CHARS=${BARGE_IN_MIN_CHARS})`
            );
            if (CALL_GREETING) {
              ttsQueue.enqueueText(CALL_GREETING);
            }
            break;

          case "media":
            if (msg.media?.payload) sttWrite(msg.media.payload);
            break;

          case "stop":
            console.log(
              `[twilio] stop streamSid=${msg.streamSid || streamSid}`
            );
            cleanup();
            break;

          default:
            break;
        }
      } catch (e: any) {
        console.error("[twilio][ws] message error:", e?.message || e);
      }
    });

    ws.on("close", () => {
      console.log("[twilio][ws] closed");
      cleanup();
    });

    ws.on("error", (err) => {
      console.error("[twilio][ws] error:", (err as any)?.message || err);
      cleanup();
    });

    function cleanup() {
      if (closed) return;
      closed = true;

      try {
        ttsQueue.close();
      } catch {
        // ignore
      }

      try {
        sttEnd?.();
      } catch {
        // ignore
      }
    }
  });

  console.log("[twilio] WebSocket server attached at /ws/twilio");
}

export default attachTwilioWs;
