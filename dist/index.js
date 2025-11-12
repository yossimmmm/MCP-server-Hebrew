// src/index.ts
import "dotenv/config";
import http from "http";
// default export מה-HTTP app
import createHttpApp from "./http/app.js";
// ייצוא בשם
import { attachMcp } from "./mcp/server.js";
import { twimlHandler } from "./telephony/twiml.js";
import { attachTwilioWs } from "./telephony/wsTwilio.js";
const PORT = Number(process.env.PORT || 8080);
const PUBLIC = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
// בונים WS/WSS נכון מתוך PUBLIC (http -> ws, https -> wss)
const wsUrl = new URL("/ws/twilio", PUBLIC);
wsUrl.protocol = wsUrl.protocol.replace("http", "ws");
const PUBLIC_WS = wsUrl.toString();
const app = createHttpApp();
// Twilio → TwiML (bi-directional: <Connect><Stream/>)
app.post("/voice", twimlHandler());
app.post("/twilio/stream-status", (_req, res) => {
    res.sendStatus(204); // 204 No Content
});
// MCP endpoint
attachMcp(app, PUBLIC);
// HTTP + WS server
const server = http.createServer(app);
attachTwilioWs(server);
server.listen(PORT, () => {
    console.log(`HTTP up on ${PUBLIC}`);
    console.log(`Twilio TwiML POST ${PUBLIC}/voice`);
    console.log(`Twilio WS at ${PUBLIC_WS}`);
});
//# sourceMappingURL=index.js.map