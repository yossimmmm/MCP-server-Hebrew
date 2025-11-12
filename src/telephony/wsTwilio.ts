// src/telephony/wsTwilio.ts
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import speakTextToTwilio from "../tts/elevenToTwilio.js";
import { createGoogleSession } from "../stt/google.js";
import { LlmSession } from "../nlu/gemini.js";

const BARGE_IN_MIN_CHARS = Number(process.env.BARGE_IN_MIN_CHARS || "5");
const TTS_START_FRAMES = Number(process.env.TTS_START_FRAMES || "10"); // ↑ safer default
const PACER_MS = Number(process.env.PACER_MS || "20");
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "eleven_v3";
const DEFAULT_LANG = process.env.TTS_LANGUAGE_CODE || "he";
const CALL_GREETING = process.env.CALL_GREETING || "";
const LLM_TRIGGER_DEBOUNCE_MS = Number(process.env.LLM_TRIGGER_DEBOUNCE_MS || "220");

// Map XI_* env into voice settings (with safe snapping for v3)
function envVoiceSettings() {
  const num = (k: string) => (process.env[k] != null ? Number(process.env[k]) : undefined);
  const bool = (k: string, def?: boolean) =>
    process.env[k] != null ? !/^(false|0)$/i.test(String(process.env[k])) : def;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const snap = (v: number, choices: number[]) =>
    choices.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a), choices[0]);

  const vs: any = {};
  const s = num("XI_STABILITY");
  if (s != null && !Number.isNaN(s)) vs.stability = snap(s, [0, 0.5, 1]);
  const sim = num("XI_SIMILARITY") ?? num("XI_SIMILARITY_BOOST");
  if (sim != null) vs.similarity_boost = clamp01(sim);
  const style = num("XI_STYLE");
  if (style != null) vs.style = clamp01(style);
  const boost = bool("XI_SPEAKER_BOOST", true);
  if (boost != null) vs.use_speaker_boost = boost;
  const rate = num("XI_SPEAKING_RATE");
  if (rate != null) vs.speaking_rate = Math.max(0.5, Math.min(2, rate));
  return Object.keys(vs).length ? vs : undefined;
}

type TwilioMsg =
  | { event: "start"; start: { streamSid: string } }
  | { event: "media"; media: { payload: string } }
  | { event: "mark"; mark: { name: string } }
  | { event: "stop"; streamSid: string }
  | { event: string; [k: string]: any };

function now() { return new Date().toISOString(); }

export function attachTwilioWs(server: http.Server) {
  const wss = new WebSocketServer({ server, path: "/ws/twilio" });

  wss.on("connection", (ws, req) => {
    console.log(`[twilio][ws] connection opened ${now()} from ${req.socket.remoteAddress}`);

    let streamSid: string | undefined;
    let ttsAbort: AbortController | undefined;
    let closed = false;

    // Single LLM chat per call
    const llm = new LlmSession();

    // One global Twilio media sequence per call
    const seqRef = { value: 0 };

    // Debounce final STT results
    let replyTimer: NodeJS.Timeout | null = null;
    let pendingText: string | null = null;

    const speak = async (text: string) => {
      // Hard stop any ongoing TTS before starting a new one
      try { ttsAbort?.abort(); } catch {}
      ttsAbort = new AbortController();
      try {
        await speakTextToTwilio(ws as WebSocket, streamSid!, text, {
          signal: ttsAbort.signal,
          startBufferFrames: TTS_START_FRAMES,
          pacerMs: PACER_MS,
          modelId: DEFAULT_MODEL,
          language_code: DEFAULT_LANG,
          voiceSettings: envVoiceSettings(),
          sequenceRef: seqRef, // keep sequence increasing across chunks
        });
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("[twilio][tts] error:", e?.message || e);
        }
      } finally {
        ttsAbort = undefined;
      }
    };

    const stt = createGoogleSession({
      onPartial: (txt) => {
        // Barge-in: cancel TTS when user starts saying something substantive
        if (txt.replace(/\s/g, "").length >= BARGE_IN_MIN_CHARS) {
          try { ttsAbort?.abort(); } catch {}
          ttsAbort = undefined;
        }
      },
      onFinal: (finalText) => {
        // Debounce multiple close-together finals into one agent turn
        pendingText = finalText;
        if (replyTimer) clearTimeout(replyTimer);
        replyTimer = setTimeout(async () => {
          const text = pendingText!;
          pendingText = null;
          const reply = await llm.reply(text);
          if (!streamSid) return;
          await speak(reply);
        }, LLM_TRIGGER_DEBOUNCE_MS);
      },
    });

    ws.on("message", async (data) => {
      try {
        const msg = JSON.parse(String(data)) as TwilioMsg;
        switch (msg.event) {
          case "start":
            streamSid = msg.start?.streamSid;
            console.log(`[twilio] start streamSid=${streamSid}`);

            if (CALL_GREETING) {
              speak(CALL_GREETING).catch((e: any) => {
                if (e?.name !== "AbortError") {
                  console.error("[twilio][tts greeting] error:", e?.message || e);
                }
              });
            }
            break;

          case "media":
            if (msg.media?.payload) stt.writeMuLaw(msg.media.payload);
            break;

          case "stop":
            console.log(`[twilio] stop streamSid=${msg.streamSid || streamSid}`);
            cleanup();
            break;
          default:
            break;
        }
      } catch (e: any) {
        console.error("[twilio][ws] message error:", e?.message || e);
      }
    });

    ws.on("close", () => { console.log("[twilio][ws] closed"); cleanup(); });
    ws.on("error", (err) => { console.error("[twilio][ws] error:", (err as any)?.message || err); cleanup(); });

    function cleanup() {
      if (closed) return;
      closed = true;
      try { ttsAbort?.abort(); } catch {}
      try { stt?.end(); } catch {}
    }
  });

  console.log("[twilio] WebSocket server attached at /ws/twilio");
}

export default attachTwilioWs;