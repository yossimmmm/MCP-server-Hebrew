// src/telephony/twiml.ts
import type { Request, Response } from "express";

/**
 * TwiML handler – מחזיר <Connect><Stream> עם כתובת WSS נכונה.
 * קודם מנסה PUBLIC_BASE_URL, אחרת גוזר מה־Host + x-forwarded-proto.
 */
function resolveWsUrl(req: Request): string {
  // אם יש כתובת בסיסית בקונפיג – נשתמש בה
  const explicitBase = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");

  const base =
    explicitBase ||
    (() => {
      const xfProto = (req.headers["x-forwarded-proto"] as string)
        ?.split(",")[0]
        ?.trim();
      const proto = xfProto || req.protocol || "http";
      const host = req.headers.host ?? "localhost";
      return `${proto}://${host}`;
    })();

  // המרה ל־ws/wss
  const wsProto = base.startsWith("https") ? "wss" : "ws";
  const withoutProto = base.replace(/^https?:\/\//, "");
  return `${wsProto}://${withoutProto}/ws/twilio`;
}

/** TwiML handler */
export function twimlHandler() {
  return (req: Request, res: Response) => {
    const wsUrl = resolveWsUrl(req);

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Response>\n` +
      `  <Connect>\n` +
      `    <Stream url="${wsUrl}" track="inbound_track"/>\n` +
      `  </Connect>\n` +
      `</Response>`;

    console.log("[twilio][twiml] wsUrl:", wsUrl);
    // אפשר לפתוח אם תרצה לראות את ה־XML המלא:
    // console.log("[twilio][twiml] xml:\n", xml);

    res.type("text/xml").send(xml);
  };
}

// נוח גם כ־default (כדי שלא תיפול על סוג ייבוא)
export default twimlHandler;
