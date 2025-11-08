// src/index.ts
import "dotenv/config";
import http from "http";
import cors from "cors";
import { createHttpApp } from "./http/app.js"; // יש לך כבר
import { attachMcp } from "./mcp/server.js"; // יש לך כבר
import { twimlHandler } from "./telephony/twiml.js";
import { attachTwilioWs } from "./telephony/wsTwilio.js";
const PORT = Number(process.env.PORT || 8080);
const PUBLIC = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const PUBLIC_WS = PUBLIC.replace(/^http/, "ws") + "/ws/twilio";
const app = createHttpApp();
app.use(cors({ origin: "*", maxAge: 600 }));
// TwiML לטלפון
app.post("/voice", twimlHandler(PUBLIC_WS));
// MCP (קיים)
attachMcp(app, PUBLIC);
// יצירת HTTP server ושידוך WS
const server = http.createServer(app);
attachTwilioWs(server);
server.listen(PORT, () => {
    console.log(`HTTP up on ${PUBLIC}`);
    console.log(`Twilio TwiML POST ${PUBLIC}/voice`);
    console.log(`Twilio WS at ${PUBLIC_WS}`);
});
