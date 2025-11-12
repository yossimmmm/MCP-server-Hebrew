// src/telephony/wsTwilio.ts
import type http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createGoogleSession } from "../stt/google.js";
import { speakTextToTwilio } from "../tts/elevenToTwilio.js";
import { LlmSession } from "../nlu/gemini.js";

type TwilioMsg =
  | { event: "start"; start: { streamSid: string } }
  | { event: "media"; media: { payload: string } }
  | { event: "stop" }
  | { event: "mark"; mark: { name?: string } }
  | { event: string; [k: string]: any };

export function attachTwilioWs(server: http.Server) {
  const wss = new WebSocketServer({ server, path: "/ws/twilio" });

  wss.on("connection", (ws: WebSocket) => {
    console.log("[WS] Twilio connected");

    let streamSid = "";
    let inboundFrames = 0;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    // One LLM chat session per call (keeps context)
    let llm: LlmSession | null = null;

    // Simple FIFO so replies don't overlap
    const toSay: string[] = [];
    let speaking = false;

    function enqueue(text: string) {
      if (!text || !text.trim()) return;
      toSay.push(text.trim());
      drain();
    }

    async function drain() {
      if (speaking) return;
      speaking = true;
      while (toSay.length && ws.readyState === WebSocket.OPEN) {
        const text = toSay.shift()!;
        try {
          await speakTextToTwilio(ws, streamSid, text, voiceId);
        } catch (e: any) {
          console.error("[TTS] speak error:", e?.message || e);
          break;
        }
      }
      speaking = false;
    }

    const stt = createGoogleSession({
      onFinal: (text) => {
        console.log("[STT final]", text);
        // Call Gemini asynchronously so we don't block WS handler
        (async () => {
          try {
            if (!llm) llm = new LlmSession();
            const reply = await llm.reply(text);
            enqueue(reply);
          } catch (err: any) {
            console.error("[LLM] error:", err?.message || err);
            enqueue("סליחה, נתקלה בעיה לרגע. אפשר לחזור על השאלה?");
          }
        })();
      },
    });

    ws.on("message", (buf) => {
      let msg: TwilioMsg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      switch (msg.event) {
        case "start":
          streamSid = (msg as any).start?.streamSid || "";
          console.log("[WS] start", streamSid);
          try { llm = new LlmSession(); } catch (e: any) {
            console.error("[LLM] init error:", e?.message || e);
          }
          if (process.env.CALL_GREETING) enqueue(process.env.CALL_GREETING);
          break;

        case "media": {
          const payload = (msg as any).media?.payload as string;
          if (payload) stt.writeMuLaw(payload);
          inboundFrames++;
          if (inboundFrames % 50 === 0) {
            console.log("[WS] inbound media frames:", inboundFrames);
          }
          break;
        }

        case "stop":
          console.log("[WS] stop", streamSid);
          try { stt.end(); } catch {}
          try { ws.close(); } catch {}
          break;

        case "mark":
          // "tts_end" arrives from speakTextToTwilio after each clip
          break;

        default:
          break;
      }
    });

    const cleanup = () => {
      try { stt.end(); } catch {}
      console.log("[WS] closed");
    };
    ws.once("close", cleanup);
    ws.once("error", cleanup);
  });
}

export default attachTwilioWs;