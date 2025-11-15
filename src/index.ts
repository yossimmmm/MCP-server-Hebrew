import "dotenv/config";
import http from "http";
import createHttpApp from "./http/app.js";
import { attachMcp } from "./mcp/server.js";
import { twimlHandler } from "./telephony/twiml.js";
import attachTwilioWs from "./telephony/wsTwilio.js";
import { getWaitingClipIds } from "./tts/staticWaitingClips.js";
import { attachWidgetRoutes } from "./widget/widgetRoutes.js";
import attachWidgetVoiceWs from "./widget/widgetVoiceWs.js";

// ---- base config ----
const PORT = Number(process.env.PORT || 8080);

// Normalize PUBLIC_BASE_URL (no trailing slash)
const RAW_PUBLIC = process.env.PUBLIC_BASE_URL;
const PUBLIC =
  (RAW_PUBLIC && RAW_PUBLIC.replace(/\/+$/, "")) ||
  `http://localhost:${PORT}`;

// Build WS URL from HTTP base
function toWsUrl(baseHttpUrl: string, path: string) {
  const u = new URL(path, baseHttpUrl);
  // If HTTPS → WSS, otherwise WS
  u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
  return u.toString();
}

const TWILIO_WS_URL = toWsUrl(PUBLIC, "/ws/twilio");
const WIDGET_WS_URL = toWsUrl(PUBLIC, "/ws/widget-voice");

// ---- express app ----
const app = createHttpApp();

// Twilio Voice webhook → returns TwiML <Connect><Stream>
app.post("/voice", twimlHandler());

// Optional: hook for Twilio stream status if needed
app.post("/twilio/stream-status", (_req, res) => res.sendStatus(204));

// Widget HTTP endpoints (JS bundle + text chat API)
attachWidgetRoutes(app);

// MCP HTTP endpoints (debug / tooling)
attachMcp(app, PUBLIC);

// ---- single HTTP server for everything ----
const server = http.createServer(app);

// WebSocket for Twilio
attachTwilioWs(server);

// WebSocket for browser widget voice
attachWidgetVoiceWs(server);

// Upgrade log (useful for debugging)
server.on("upgrade", (req, _socket, _head) => {
  console.log("[server][upgrade] incoming WS upgrade for:", req.url);
});

// Top level server errors
server.on("error", (err) => {
  console.error("[server] error:", err);
  process.exitCode = 1;
});

// Load waiting clips (if the directory is missing, the module will warn)
const waitingIds = getWaitingClipIds();
console.log("[waiting] loaded clips:", waitingIds);

// Start listening
server.listen(PORT, () => {
  console.log(`[server] HTTP listening at ${PUBLIC}`);
  console.log(`[twilio] TwiML webhook POST ${PUBLIC}/voice`);
  console.log(`[twilio] WebSocket ${TWILIO_WS_URL}`);
  console.log(`[widget-voice] WebSocket ${WIDGET_WS_URL}`);
  console.log(`[widget] script ${PUBLIC}/widget.js`);
});

// ---- graceful shutdown & global error handlers ----
function shutdown(reason: string) {
  console.log(`[server] shutting down (${reason})...`);
  server.close((err) => {
    if (err) {
      console.error("[server] close error:", err);
      process.exit(1);
    } else {
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
