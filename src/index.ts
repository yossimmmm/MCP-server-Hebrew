// src/index.ts
import "dotenv/config";
import http from "http";
import createHttpApp from "./http/app.js";
import { attachMcp } from "./mcp/server.js";
import { twimlHandler } from "./telephony/twiml.js";
import attachTwilioWs from "./telephony/wsTwilio.js";

// Normalize PORT and PUBLIC base URL (strip trailing slash)
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC =
  (process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ??
    `http://localhost:${PORT}`);

// Build the WS endpoint URL from PUBLIC (http→ws, https→wss)
function toWsUrl(baseHttpUrl: string, path: string) {
  const u = new URL(path, baseHttpUrl);
  u.protocol = u.protocol.replace("http", "ws"); // http->ws, https->wss
  return u.toString();
}
const PUBLIC_WS = toWsUrl(PUBLIC, "/ws/twilio");

// Construct HTTP app and routes
const app = createHttpApp();

// Twilio webhooks
app.post("/voice", twimlHandler());
app.post("/twilio/stream-status", (_req, res) => res.sendStatus(204));

// MCP endpoint(s)
attachMcp(app, PUBLIC);

// HTTP server + Twilio WS
const server = http.createServer(app);
attachTwilioWs(server);

// Basic diagnostics
server.on("error", (err) => {
  console.error("[server] error:", err);
  process.exitCode = 1;
});

server.listen(PORT, () => {
  console.log(`[server] HTTP listening at ${PUBLIC}`);
  console.log(`[twilio] TwiML webhook POST ${PUBLIC}/voice`);
  console.log(`[twilio] WebSocket ${PUBLIC_WS}`);
});

// Graceful shutdown
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
});