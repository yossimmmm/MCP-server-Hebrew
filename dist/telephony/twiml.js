/** TwiML handler – מחזיר Stream עם WSS לפי ה־Host/Proto של הבקשה (ngrok) */
export function twimlHandler() {
    return (req, res) => {
        const xfProto = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
        const proto = xfProto || req.protocol;
        const host = req.headers.host;
        const wsProto = proto === "https" ? "wss" : "ws";
        const wsUrl = `${wsProto}://${host}/ws/twilio`;
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}" track="inbound_track"/>
  </Connect>
</Response>`;
        res.type("text/xml").send(xml);
    };
}
// נוח גם כ־default (כדי שלא תיפול על סוג ייבוא)
export default twimlHandler;
//# sourceMappingURL=twiml.js.map