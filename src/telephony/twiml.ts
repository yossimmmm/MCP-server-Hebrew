import type { Request, Response } from "express";

export function twimlHandler(publicWsUrl: string) {
  // Example: wss://<domain>/ws/twilio
  return (_req: Request, res: Response) => {
    const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${publicWsUrl}"/>
  </Connect>
</Response>`;
    res.type("text/xml").send(xml);
  };
}
