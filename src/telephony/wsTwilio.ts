// src/telephony/wsTwilio.ts
import WebSocket, { WebSocketServer } from "ws";
import { createGoogleSession, GoogleSttSession } from "../stt/google.js";
import { speakTextToTwilio } from "../tts/elevenToTwilio.js";


function send(ws: WebSocket, obj: any) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

export function attachTwilioWs(server: any) {
  const wss = new WebSocketServer({ server, path: "/ws/twilio" });

  wss.on("connection", (ws: WebSocket) => {
    console.log("[WS] Twilio connected");
    const sessions: Map<string, GoogleSttSession> = new Map();
    let mediaCount = 0;

    const endAll = () => { for (const s of sessions.values()) { try { s.end(); } catch {} } sessions.clear(); };

    ws.on("message", async (raw: WebSocket.RawData) => {
      let msg: any; try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.event) {
        case "start": {
          const { streamSid } = msg;
          console.log("[WS] start", streamSid);
          sessions.get(streamSid)?.end();
          sessions.set(streamSid, createGoogleSession());

          // ברכת פתיחה
          speakTextToTwilio(ws, streamSid, "היי, השרת באוויר. תגיד משהו ואני אשמע.")
            .catch(e => console.error("TTS->Twilio failed:", e?.message || e));
          break;
        }

        case "media": {
          const { streamSid } = msg;
          if ((++mediaCount % 50) === 0) console.log("[WS] inbound media frames:", mediaCount);
          const s = sessions.get(streamSid); if (!s) break;
          const b64 = msg.media?.payload; if (!b64) break;
          const ok = s.writeMuLaw(b64); if (!ok) sessions.delete(streamSid);
          break;
        }

        case "stop": {
          const { streamSid } = msg;
          console.log("[WS] stop", streamSid);
          sessions.get(streamSid)?.end();
          sessions.delete(streamSid);
          break;
        }
      }
    });

    ws.on("close", () => { console.log("[WS] closed"); endAll(); });
    ws.on("error", (e) => { console.error("[WS] error", (e as any)?.message || e); endAll(); });
  });
}
