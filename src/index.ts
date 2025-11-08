// src/index.ts
import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { createHttpApp } from "./http/app.js";
import { attachMcp } from "./mcp/server.js";
import { twimlHandler } from "./telephony/twiml.js";
import { attachTwilioWs } from "./telephony/wsTwilio.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const PUBLIC_WS = PUBLIC.replace(/^http/, "ws") + "/ws/twilio";

const app = createHttpApp();
app.use(cors({ origin: "*", maxAge: 600 }));

// Twilio → TwiML
app.post("/voice", twimlHandler(PUBLIC_WS));

// MCP
attachMcp(app, PUBLIC);

// HTTP + WS
const server = http.createServer(app);
attachTwilioWs(server);

server.listen(PORT, () => {
  console.log(`HTTP up on ${PUBLIC}`);
  console.log(`Twilio TwiML POST ${PUBLIC}/voice`);
  console.log(`Twilio WS at ${PUBLIC_WS}`);
});
