import "dotenv/config";
import http from "http";
import createHttpApp from "./http/app.js";
import { attachMcp } from "./mcp/server.js";
import { attachWidgetRoutes } from "./widget/widgetRoutes.js";
import attachWidgetVoiceWs from "./widget/widgetVoiceWs.js";

// ---- base config ----
const PORT = Number(process.env.PORT || 8080);

// Normalize PUBLIC_BASE_URL (no trailing slash)
const RAW_PUBLIC = process.env.PUBLIC_BASE_URL;
const PUBLIC =
  (RAW_PUBLIC && RAW_PUBLIC.replace(/\/+$/, "")) ||
  `http://localhost:${PORT}`;

// Build WS URL from HTTP base (for logging only)
function toWsUrl(baseHttpUrl: string, path: string) {
  const u = new URL(path, baseHttpUrl);
  u.protocol = u.protocol.startsWith("https") ? "wss:" : "ws:";
  return u.toString();
}

const WIDGET_WS_URL = toWsUrl(PUBLIC, "/ws/widget-voice");

// ---- express app ----
const app = createHttpApp();

// Widget HTTP endpoints (JS bundle + text chat API)
attachWidgetRoutes(app);

// Optional: MCP HTTP endpoints for debug / tooling
attachMcp(app, PUBLIC);

// ---- single HTTP server for widget ----
const server = http.createServer(app);

// WebSocket for browser widget voice
attachWidgetVoiceWs(server);

// Upgrade log (debug)
server.on("upgrade", (req, _socket, _head) => {
  console.log("[widget-server][upgrade] incoming WS upgrade for:", req.url);
});

// Top level server errors
server.on("error", (err) => {
  console.error("[widget-server] error:", err);
  process.exitCode = 1;
});

// Start listening
server.listen(PORT, () => {
  console.log(`[widget-server] HTTP listening at ${PUBLIC}`);
  console.log(`[widget] script ${PUBLIC}/widget.js`);
  console.log(`[widget-voice] WebSocket ${WIDGET_WS_URL}`);
});

// ---- graceful shutdown & global error handlers ----
function shutdown(reason: string) {
  console.log(`[widget-server] shutting down (${reason})...`);
  server.close((err) => {
    if (err) {
      console.error("[widget-server] close error:", err);
      process.exit(1);
    } else {
      console.log("[widget-server] closed.");
      process.exit(0);
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (e) => {
  console.error("[widget-uncaughtException]", e);
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (e) => {
  console.error("[widget-unhandledRejection]", e);
  shutdown("unhandledRejection");
});
