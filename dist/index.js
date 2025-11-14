// src/index.ts
import "dotenv/config";
import http from "http";
import createHttpApp from "./http/app.js";
import { attachMcp } from "./mcp/server.js";
import { twimlHandler } from "./telephony/twiml.js";
import attachTwilioWs from "./telephony/wsTwilio.js";
import { getWaitingClipIds } from "./tts/staticWaitingClips.js";
// ---- base config ----
const PORT = Number(process.env.PORT || 8080);
// נרמול PUBLIC_BASE_URL (ללא / בסוף)
const RAW_PUBLIC = process.env.PUBLIC_BASE_URL;
const PUBLIC = (RAW_PUBLIC && RAW_PUBLIC.replace(/\/+$/, "")) ||
    `http://localhost:${PORT}`;
// פונקציה לייצר WS URL מה-HTTP base
function toWsUrl(baseHttpUrl, path) {
    const u = new URL(path, baseHttpUrl);
    // אם HTTPS → WSS, אחרת WS
    u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
    return u.toString();
}
const TWILIO_WS_URL = toWsUrl(PUBLIC, "/ws/twilio");
const WIDGET_WS_URL = toWsUrl(PUBLIC, "/ws/widget-voice");
// ---- express app ----
const app = createHttpApp();
// Twilio Voice webhook → מחזיר TwiML עם <Connect><Stream>
app.post("/voice", twimlHandler());
// אופציונלי: hook ל-status של ה-stream אם תרצה להשתמש
app.post("/twilio/stream-status", (_req, res) => res.sendStatus(204));
// MCP HTTP endpoints (ל-debug / tooling)
attachMcp(app, PUBLIC);
// ---- HTTP server אחד בלבד ----
const server = http.createServer(app);
// WebSocket ל-Twilio
attachTwilioWs(server);
// לוג על upgrade (לא חובה, עוזר ל-debug)
server.on("upgrade", (req, _socket, _head) => {
    console.log("[server][upgrade] incoming WS upgrade for:", req.url);
});
// error ברמת השרת
server.on("error", (err) => {
    console.error("[server] error:", err);
    process.exitCode = 1;
});
// טוען קליפים של waiting (אם אין תיקייה, נקבל אזהרה מהמודול עצמו)
const waitingIds = getWaitingClipIds();
console.log("[waiting] loaded clips:", waitingIds);
// start
server.listen(PORT, () => {
    console.log(`[server] HTTP listening at ${PUBLIC}`);
    console.log(`[twilio] TwiML webhook POST ${PUBLIC}/voice`);
    console.log(`[twilio] WebSocket ${TWILIO_WS_URL}`);
    console.log(`[widget-voice] WebSocket ${WIDGET_WS_URL}`);
});
// ---- graceful shutdown & errors ----
function shutdown(reason) {
    console.log(`[server] shutting down (${reason})...`);
    server.close((err) => {
        if (err) {
            console.error("[server] close error:", err);
            process.exit(1);
        }
        else {
            console.log("[server] closed.");
            process.exit(0);
        }
    });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (e) => {
    console.error("[uncaughtException]", e);
    shutdown("uncaughtException");
});
process.on("unhandledRejection", (e) => {
    console.error("[unhandledRejection]", e);
    shutdown("unhandledRejection");
});
