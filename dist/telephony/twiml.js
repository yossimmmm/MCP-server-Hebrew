export function twimlHandler(publicWsUrl) {
    // publicWsUrl דוגמה: wss://<domain>/ws/twilio
    return (_req, res) => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
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
