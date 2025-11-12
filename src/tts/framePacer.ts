import WebSocket from "ws";

export class FramePacer {
  private q: Buffer[] = [];
  private timer?: NodeJS.Timeout;
  private seq = 0;
  static readonly SILENCE_160 = Buffer.alloc(160, 0xFF); // μ-law silence

  constructor(private ws: WebSocket, private streamSid: string) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.ws.readyState !== WebSocket.OPEN) return;
      const frame = this.q.length ? this.q.shift()! : FramePacer.SILENCE_160;
      this.ws.send(JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        sequenceNumber: String(++this.seq),
        media: { payload: frame.toString("base64") },
      }));
    }, 20);
  }

  push(frame160: Buffer) { this.q.push(frame160); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
