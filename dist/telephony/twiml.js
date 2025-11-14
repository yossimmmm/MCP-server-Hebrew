/**
 * TwiML handler – מחזיר <Connect><Stream> עם כתובת WSS נכונה.
 * קודם מנסה PUBLIC_BASE_URL, אחרת גוזר מה־Host + x-forwarded-proto.
 */
function resolveWsUrl(req) {
    const explicitBase = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
    const base = explicitBase ||
        (() => {
            const xfProto = req.headers["x-forwarded-proto"]
                ?.split(",")[0]
                ?.trim();
            const proto = xfProto || req.protocol || "http";
            const host = req.headers.host ?? "localhost";
            return `${proto}://${host}`;
        })();
    const wsProto = base.startsWith("https") ? "wss" : "ws";
    const withoutProto = base.replace(/^https?:\/\//, "");
    return `${wsProto}://${withoutProto}/ws/twilio`;
}
/** TwiML handler */
export function twimlHandler() {
    return (req, res) => {
        const wsUrl = resolveWsUrl(req);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<Response>\n` +
            `  <Connect>\n` +
            `    <Stream url="${wsUrl}"/>\n` + // 👈 בלי track
            `  </Connect>\n` +
            `</Response>`;
        console.log("[twilio][twiml] wsUrl:", wsUrl);
        // console.log("[twilio][twiml] xml:\n", xml); // אם תרצה לבדוק
        res.type("text/xml").send(xml);
    };
}
export default twimlHandler;
