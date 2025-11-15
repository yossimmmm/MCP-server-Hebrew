import WebSocket from "ws";
import speakTextToTwilio from "./elevenToTwilio.js";
import { playWaitingClip } from "./staticWaitingClips.js";

type SequenceRef = { value: number };

export type TtsQueueOptions = {
  ws: WebSocket;
  getStreamSid: () => string | undefined;
  sequenceRef: SequenceRef;
  modelId: string;
  languageCode: string;
  startBufferFrames: number;
  pacerMs: number;
  voiceSettings?: any;
  defaultWaitDelayMs?: number;
};

type TtsJob =
  | { kind: "text"; text: string }
  | { kind: "clip"; clipId: string; delayMs?: number };

export class TtsQueue {
  private readonly ws: WebSocket;
  private readonly getStreamSid: () => string | undefined;
  private readonly sequenceRef: SequenceRef;
  private readonly modelId: string;
  private readonly languageCode: string;
  private readonly startBufferFrames: number;
  private readonly pacerMs: number;
  private readonly voiceSettings?: any;
  private readonly defaultWaitDelayMs: number;

  private jobs: TtsJob[] = [];
  private running = false;
  private closed = false;
  private currentAbort: AbortController | null = null;

  constructor(opts: TtsQueueOptions) {
    this.ws = opts.ws;
    this.getStreamSid = opts.getStreamSid;
    this.sequenceRef = opts.sequenceRef;
    this.modelId = opts.modelId;
    this.languageCode = opts.languageCode;
    this.startBufferFrames = opts.startBufferFrames;
    this.pacerMs = opts.pacerMs;
    this.voiceSettings = opts.voiceSettings;
    this.defaultWaitDelayMs = opts.defaultWaitDelayMs ?? 0;
  }

  enqueueText(text: string) {
    if (this.closed) return;
    const trimmed = (text || "").trim();
    if (!trimmed) return;

    this.jobs.push({ kind: "text", text: trimmed });
    this.processQueue();
  }

  enqueueClip(
  clipId: string,
  delay?: number | { delayMs?: number }
) {
  if (this.closed) return;
  if (!clipId) return;

  let delayMs: number | undefined;

  if (typeof delay === "number") {
    delayMs = delay;
  } else if (delay && typeof delay.delayMs === "number") {
    delayMs = delay.delayMs;
  }

  this.jobs.push({ kind: "clip", clipId, delayMs });
  this.processQueue();
}


  // Cancel current TTS and clear pending jobs
  bargeIn() {
    if (this.closed) return;
    this.jobs = [];
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        // ignore
      }
    }
  }

  // Close the queue and stop all playback
  close() {
    if (this.closed) return;
    this.closed = true;
    this.jobs = [];
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        // ignore
      }
    }
  }

  private async processQueue() {
    if (this.running) return;
    if (this.closed) return;
    this.running = true;

    while (!this.closed && this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      const streamSid = this.getStreamSid();
      if (!streamSid) {
        console.warn("[TTS queue] streamSid missing, dropping job kind=", job.kind);
        continue;
      }

      const ac = new AbortController();
      this.currentAbort = ac;
      const signal = ac.signal;

      try {
        if (job.kind === "text") {
          await speakTextToTwilio(this.ws, streamSid, job.text, {
            signal,
            startBufferFrames: this.startBufferFrames,
            pacerMs: this.pacerMs,
            modelId: this.modelId,
            language_code: this.languageCode,
            voiceSettings: this.voiceSettings,
            sequenceRef: this.sequenceRef,
          });
        } else if (job.kind === "clip") {
          const delayMs =
            job.delayMs != null ? job.delayMs : this.defaultWaitDelayMs;

          if (delayMs > 0) {
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, delayMs);
              const onAbort = () => {
                clearTimeout(t);
                resolve();
              };

              if (signal.aborted) {
                clearTimeout(t);
                resolve();
              } else {
                signal.addEventListener("abort", onAbort, { once: true });
              }
            });

            if (signal.aborted || this.closed) {
              continue;
            }
          }

          await playWaitingClip(
            this.ws,
            streamSid,
            job.clipId,
            this.sequenceRef,
            signal
          );
        }
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("[TTS queue] job error:", e?.message || e);
        }
      } finally {
        if (!signal.aborted) {
          this.currentAbort = null;
        }
      }
    }

    this.running = false;
  }
}

export default TtsQueue;
