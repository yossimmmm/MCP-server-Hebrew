// src/telephony/twiml.ts
import type { Request, Response } from "express";

export function twimlHandler(publicWsUrl: string) {
  // publicWsUrl דוגמה: wss://<domain>/ws/twilio
  return (_req: Request, res: Response) => {
    const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="${publicWsUrl}" track="both_tracks"/>
  </Start>
  <Pause length="600"/>
</Response>`;
    res.setHeader("Content-Type", "text/xml");
    res.send(xml);
  };
}
