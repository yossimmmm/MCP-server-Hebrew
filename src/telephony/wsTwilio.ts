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

    const endAll = () => {
      for (const s of sessions.values()) { try { s.end(); } catch {} }
      sessions.clear();
    };

    ws.on("message", async (raw: WebSocket.RawData) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.event) {
        case "start": {
          const streamSid: string | undefined = msg.start?.streamSid ?? msg.streamSid;
          if (!streamSid) { console.error("[WS] start event missing streamSid"); break; }
          console.log("[WS] start", streamSid);

          sessions.get(streamSid)?.end();
          sessions.set(streamSid, createGoogleSession());

          try {
            await speakTextToTwilio(ws, streamSid, "היי, השיחה עלתה. תגיד משהו ואני אשמע.");
          } catch (e: any) {
            console.error("TTS->Twilio failed:", e?.message || e);
          }
          break;
        }

        case "media": {
          const streamSid: string | undefined = msg.streamSid;
          if (!streamSid) break;
          if ((++mediaCount % 50) === 0) console.log("[WS] inbound media frames:", mediaCount);
          const s = sessions.get(streamSid);
          if (!s) break;
          const b64: string | undefined = msg.media?.payload;
          if (!b64) break;
          const ok = s.writeMuLaw(b64);
          if (!ok) sessions.delete(streamSid);
          break;
        }

        case "mark": {
          // optional: handle marks you sent (e.g., "tts_end")
          break;
        }

        case "stop": {
          const streamSid: string | undefined = msg.stop?.streamSid ?? msg.streamSid;
          console.log("[WS] stop", streamSid || "(none)");
          if (streamSid && sessions.has(streamSid)) {
            sessions.get(streamSid)?.end();
            sessions.delete(streamSid);
          }
          break;
        }

        default:
          break;
      }
    });

    ws.on("close", () => { console.log("[WS] closed"); endAll(); });
    ws.on("error", (e) => { console.error("[WS] error", (e as any)?.message || e); endAll(); });
  });
}
