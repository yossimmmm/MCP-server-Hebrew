// src/index.ts
import "dotenv/config";
import http from "http";
import createHttpApp from "./http/app.js";
import { attachMcp } from "./mcp/server.js";
import { twimlHandler } from "./telephony/twiml.js";
import attachTwilioWs from "./telephony/wsTwilio.js";
import { attachWidgetRoutes } from "./widget/widgetRoutes.js";
import attachWidgetVoiceWs from "./widget/widgetVoiceWs.js";

// Normalize PORT and PUBLIC base URL (strip trailing slash)
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = (
  process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`
).replace(/\/+$/, "");

const app = createHttpApp();

// Twilio voice webhook (TwiML)
app.post("/voice", twimlHandler);
console.log("[twilio] TwiML webhook POST", `${PUBLIC}/voice`);

// Widget HTTP routes (widget.js + /api/widget/message)
attachWidgetRoutes(app);

// HTTP server
const server = http.createServer(app);

// Twilio media-stream WebSocket
attachTwilioWs(server);

// Widget voice WebSocket (mic <-> STT <-> LLM <-> TTS)
attachWidgetVoiceWs(server);

// MCP tools / protocol server
attachMcp(server);

server.listen(PORT, () => {
  console.log("[server] HTTP listening at", PUBLIC);
});
