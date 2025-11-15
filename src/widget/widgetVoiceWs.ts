// src/widget/widgetVoiceWs.ts
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { createHebrewChirp3Stream } from "../stt/googleChirpV2.js";
import { getOrCreateSession } from "./widgetRoutes.js";

const API_BASE = (
  process.env.PUBLIC_BASE_URL ??
  `http://localhost:${process.env.PORT ?? 8080}`
).replace(/\/+$/, "");

const WIDGET_VOICE_ID = process.env.WIDGET_VOICE_ID ?? "";

// אפשר להשתמש ב־SPEECH_V2_RECOGNIZER_WIDGET או בברירת מחדל הכללית
const STT_RECOGNIZER =
  process.env.SPEECH_V2_RECOGNIZER_WIDGET ??
  process.env.SPEECH_V2_RECOGNIZER ??
  "";

if (!STT_RECOGNIZER) {
  console.warn("[widget-voice] SPEECH_V2_RECOGNIZER is not set");
}

type SttHandle = ReturnType<typeof createHebrewChirp3Stream>;

type WidgetWsState = {
  sessionId: string | null;
  stt: SttHandle | null;
  closed: boolean;
};

export default function attachWidgetVoiceWs(server: http.Server): void {
  const wss = new WebSocketServer({
    server,
    path: "/ws/widget-voice",
  });

  wss.on("connection", (ws: WebSocket) => {
    const state: WidgetWsState = {
      sessionId: null,
      stt: null,
      closed: false,
    };

    function safeSend(obj: any) {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify(obj));
      } catch (e) {
        console.error("[widget-voice] send error", e);
      }
    }

    function ensureStt() {
      if (state.stt || !STT_RECOGNIZER) return;

      state.stt = createHebrewChirp3Stream(STT_RECOGNIZER, {
        decodingConfig: {
          encoding: "LINEAR16",
          sampleRateHertz: 48000,
          audioChannelCount: 1,
        },
        interimResults: true,
        async onData(text, isFinal) {
          try {
            if (!text) return;

            if (!isFinal) {
              // partial
              safeSend({ type: "transcript", text, final: false });
              return;
            }

            // final user text
            safeSend({ type: "transcript", text, final: true });

            const sess = getOrCreateSession(state.sessionId);
            state.sessionId = sess.id;

            // לעדכן קליינט מה ה־sessionId הסופי
            safeSend({ type: "session", sessionId: sess.id });

            const reply = await sess.llm.replyFinal(text);

            const qs = new URLSearchParams({
              text: reply,
              output_format: "opus_48000_128",
            });
            if (WIDGET_VOICE_ID) {
              qs.set("voice_id", WIDGET_VOICE_ID);
            }
            const ttsUrl = `${API_BASE}/stream/tts?${qs.toString()}`;

            safeSend({
              type: "agent_reply",
              reply,
              ttsUrl,
            });
          } catch (e: any) {
            console.error(
              "[widget-voice] LLM/handler error:",
              e?.message || e
            );
            safeSend({ type: "error", reason: "llm_error" });
          }
        },
        onError(err) {
          console.error("[widget-voice] STT error:", err.message || err);
          safeSend({ type: "error", reason: "stt_error" });
        },
        onEnd() {
          console.log("[widget-voice] STT end");
        },
      });
    }

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(String(data));
        if (!msg || typeof msg !== "object") return;

        // init מהקליינט: { type: "init", sessionId? }
        if (msg.type === "init") {
          const sid =
            typeof msg.sessionId === "string" && msg.sessionId.trim()
              ? msg.sessionId.trim()
              : null;
          if (sid) {
            state.sessionId = sid;
          }

          safeSend({
            type: "session",
            sessionId: state.sessionId,
          });

          // STT ייווצר רק כשמגיעה אודיו
          return;
        }

        // אודיו: { type: "audio", pcm: "<base64 of 16bit PCM @48kHz>" }
        if (msg.type === "audio" && typeof msg.pcm === "string") {
          if (!STT_RECOGNIZER) {
            safeSend({ type: "error", reason: "stt_not_configured" });
            return;
          }
          ensureStt();
          if (!state.stt) return;

          // השם writeMuLawBase64 נשאר היסטורית, בפועל זה עכשיו base64 של LINEAR16
          state.stt.writeMuLawBase64(msg.pcm);
          return;
        }

        // בקשת סגירה מהקליינט
        if (msg.type === "close") {
          ws.close();
          return;
        }
      } catch (e) {
        console.error("[widget-voice] bad message", e);
      }
    });

    ws.on("close", () => {
      state.closed = true;
      if (state.stt) {
        try {
          state.stt.end();
        } catch {
          // ignore
        }
      }
    });

    ws.on("error", (err) => {
      console.error("[widget-voice] ws error:", err);
    });
  });

  console.log("[widget-voice] WebSocket server attached at /ws/widget-voice");
}
