export function twimlHandler() {
    return (req, res) => {
        const xfProto = req.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
        const proto = xfProto || req.protocol; // "https" מאחורי ngrok
        const host = req.headers.host; // <subdomain>.ngrok-free.dev
        const wsProto = proto === "https" ? "wss" : "ws";
        const wsUrl = `${wsProto}://${host}/ws/twilio`;
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${wsUrl}"/>
  </Connect>
</Response>`;
        res.type("text/xml").send(xml);
    };
}
//# sourceMappingURL=twiml.js.map