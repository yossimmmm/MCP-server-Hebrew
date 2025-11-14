import { randomUUID } from "node:crypto";
import { LlmSession } from "../nlu/gemini.js";
const SESSIONS = new Map();
// 30 minutes TTL
const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;
// Base URL for the API the widget calls
const API_BASE = (process.env.PUBLIC_BASE_URL ??
    `http://localhost:${process.env.PORT ?? 8080}`).replace(/\/+$/, "");
// Optional: dedicated voice for the widget (not חובה)
const WIDGET_VOICE_ID = process.env.WIDGET_VOICE_ID ?? "";
// Max characters per user message (מונע abuse)
const MAX_INPUT_CHARS = 1000;
// ---- session management ----
export function getOrCreateSession(sessionId) {
    const now = Date.now();
    if (sessionId) {
        const existing = SESSIONS.get(sessionId);
        if (existing) {
            // אם עוד לא פג תוקף – מחזירים ומעדכנים last access
            if (now - existing.createdAt < SESSION_TTL_MS) {
                existing.createdAt = now;
                return existing;
            }
            // פג תוקף – מוחקים ויוצרים חדש
            SESSIONS.delete(sessionId);
        }
    }
    const id = randomUUID();
    const llm = new LlmSession();
    const session = { id, llm, createdAt: now };
    SESSIONS.set(id, session);
    return session;
}
// ניקוי מחזורי של סשנים שפג תוקפם
setInterval(() => {
    const now = Date.now();
    for (const [id, sess] of SESSIONS) {
        if (now - sess.createdAt >= SESSION_TTL_MS) {
            SESSIONS.delete(id);
        }
    }
}, SESSION_SWEEP_INTERVAL_MS).unref?.();
// ---- tiny JS bundle for the widget ----
function buildWidgetBundle() {
    const apiBase = API_BASE;
    // NOTE: keep this vanilla so it runs on any site, no bundler required
    return `
(function () {
  "use strict";
  const API_BASE = ${JSON.stringify(apiBase)};
  const WS_BASE = API_BASE.replace(/^http/, "ws");

  function createStyles() {
    if (document.getElementById("furne-widget-styles")) return;
    const style = document.createElement("style");
    style.id = "furne-widget-styles";
    style.textContent = \`
      .furne-widget-root {
        position: fixed;
        z-index: 999999;
        bottom: 16px;
        right: 16px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .furne-widget-toggle {
        width: 52px;
        height: 52px;
        border-radius: 999px;
        border: none;
        background: #000;
        color: #fff;
        cursor: pointer;
        box-shadow: 0 8px 20px rgba(0,0,0,.25);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
      }
      .furne-widget-toggle:hover { filter: brightness(1.1); }
      .furne-widget-panel {
        position: absolute;
        bottom: 64px;
        right: 0;
        width: 320px;
        max-height: 420px;
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 12px 32px rgba(0,0,0,.2);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transform: translateY(10px);
        pointer-events: none;
        transition: opacity .18s ease, transform .18s ease;
      }
      .furne-widget-root.fw-open .furne-widget-panel {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
      }
      .furne-widget-header {
        padding: 10px 14px;
        border-bottom: 1px solid #f3f4f6;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        background: #f9fafb;
      }
      .furne-widget-header-title {
        font-size: 14px;
        font-weight: 600;
      }
      .furne-widget-header-sub {
        font-size: 11px;
        color: #6b7280;
      }
      .furne-widget-call-btn {
        border-radius: 999px;
        border: 1px solid #e5e7eb;
        padding: 6px 10px;
        font-size: 11px;
        background: #111827;
        color: #f9fafb;
        cursor: pointer;
        white-space: nowrap;
      }
      .furne-widget-call-btn.fw-on {
        background: #dc2626;
        border-color: #b91c1c;
      }
      .furne-widget-messages {
        flex: 1;
        padding: 10px 12px;
        overflow-y: auto;
        background: #ffffff;
      }
      .furne-widget-msg {
        max-width: 80%;
        margin-bottom: 6px;
        padding: 7px 10px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.35;
        word-wrap: break-word;
        white-space: pre-wrap;
      }
      .furne-widget-msg-user {
        margin-left: auto;
        background: #000;
        color: #fff;
        border-bottom-right-radius: 4px;
      }
      .furne-widget-msg-agent {
        margin-right: auto;
        background: #f3f4f6;
        color: #111827;
        border-bottom-left-radius: 4px;
      }
      .furne-widget-msg-system {
        margin: 6px auto;
        max-width: 90%;
        background: transparent;
        color: #9ca3af;
        font-size: 11px;
        text-align: center;
      }
      .furne-widget-msg-interim {
        font-style: italic;
        opacity: 0.85;
      }
      .furne-widget-input-row {
        padding: 8px;
        border-top: 1px solid #f3f4f6;
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .furne-widget-input-row input {
        flex: 1;
        border-radius: 999px;
        border: 1px solid #e5e7eb;
        padding: 7px 11px;
        font-size: 13px;
        outline: none;
      }
      .furne-widget-input-row input:focus {
        border-color: #111827;
      }
      .furne-widget-input-row button {
        border-radius: 999px;
        border: none;
        padding: 7px 12px;
        font-size: 13px;
        background: #000;
        color: #fff;
        cursor: pointer;
      }
      .furne-widget-input-row button:disabled {
        opacity: .6;
        cursor: default;
      }
    \`;
    document.head.appendChild(style);
  }

  function floatTo16BitPCM(float32) {
    const len = float32.length;
    const out = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      let s = float32[i];
      if (s < -1) s = -1;
      if (s > 1) s = 1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function int16ToBase64(int16) {
    const u8 = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
    let bin = "";
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  function createWidget() {
    if (document.querySelector(".furne-widget-root")) return;
    createStyles();

    const root = document.createElement("div");
    root.className = "furne-widget-root";

    root.innerHTML = \`
      <div class="furne-widget-panel">
        <div class="furne-widget-header">
          <div>
            <div class="furne-widget-header-title">Need help?</div>
            <div class="furne-widget-header-sub">Chat or talk with the FURNE assistant</div>
          </div>
          <button type="button" class="furne-widget-call-btn">Start call</button>
        </div>
        <div class="furne-widget-messages"></div>
        <form class="furne-widget-input-row">
          <input type="text" placeholder="Ask me anything about your space..." />
          <button type="submit">Send</button>
        </form>
      </div>
      <button class="furne-widget-toggle" aria-label="Open assistant">
        ?
      </button>
    \`;

    document.body.appendChild(root);

    const panel = root.querySelector(".furne-widget-panel");
    const toggle = root.querySelector(".furne-widget-toggle");
    const messagesEl = root.querySelector(".furne-widget-messages");
    const form = root.querySelector(".furne-widget-input-row");
    const input = form && form.querySelector("input");
    const sendBtn = form && form.querySelector("button");
    const callBtn = root.querySelector(".furne-widget-call-btn");

    if (!panel || !toggle || !messagesEl || !form || !input || !sendBtn || !callBtn) {
      console.error("[FURNE widget] missing DOM nodes, aborting init");
      root.remove();
      return;
    }

    const audio = new Audio();
    audio.autoplay = true;

    /** @type {string | null} */
    let sessionId = null;
    let busy = false;

    // voice-call state
    let callActive = false;
    let ws = null;
    let mediaStream = null;
    let audioCtx = null;
    let processor = null;
    let interimDiv = null;

    function addMessage(kind, text) {
      if (!text) return;
      const div = document.createElement("div");
      div.classList.add("furne-widget-msg");
      if (kind === "user") div.classList.add("furne-widget-msg-user");
      else if (kind === "agent") div.classList.add("furne-widget-msg-agent");
      else div.classList.add("furne-widget-msg-system");
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setCallButtonState() {
      if (!callBtn) return;
      if (callActive) {
        callBtn.classList.add("fw-on");
        callBtn.textContent = "End call";
      } else {
        callBtn.classList.remove("fw-on");
        callBtn.textContent = "Start call";
      }
    }

    toggle.addEventListener("click", function () {
      root.classList.toggle("fw-open");
      if (root.classList.contains("fw-open")) {
        input.focus();
      }
    });

    form.addEventListener("submit", async function (evt) {
      evt.preventDefault();
      if (busy) return;
      const text = (input.value || "").trim();
      if (!text) return;

      input.value = "";
      addMessage("user", text);
      busy = true;
      sendBtn.disabled = true;

      const payload = { text };
      if (sessionId) {
        payload.sessionId = sessionId;
      }

      try {
        const res = await fetch(API_BASE + "/api/widget/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          addMessage("system", "There was an error. Please try again.");
          return;
        }

        const data = await res.json();
        if (data.sessionId) {
          sessionId = data.sessionId;
        }

        if (data.reply) {
          addMessage("agent", data.reply);
        }
        if (data.ttsUrl) {
          const url = data.ttsUrl + (data.ttsUrl.includes("?") ? "&" : "?") + "_ts=" + Date.now();
          audio.src = url;
          audio.play().catch(function () {});
        }
      } catch (e) {
        console.error("[FURNE widget] error", e);
        addMessage("system", "There was an error. Please try again.");
      } finally {
        busy = false;
        sendBtn.disabled = false;
      }
    });

    async function startCall() {
      if (callActive) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addMessage("system", "Microphone is not available in this browser.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStream = stream;

        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC({ sampleRate: 48000 });
        audioCtx = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const processorNode = ctx.createScriptProcessor(2048, 1, 1);
        processor = processorNode;

        processorNode.onaudioprocess = function (event) {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;
          const inputBuf = event.inputBuffer.getChannelData(0);
          const pcm16 = floatTo16BitPCM(inputBuf);
          const b64 = int16ToBase64(pcm16);
          try {
            ws.send(JSON.stringify({ type: "audio", pcm: b64 }));
          } catch (e) {
            console.error("[FURNE widget] send audio error", e);
          }
        };

        // למנוע הד
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(processorNode);
        processorNode.connect(gain);
        gain.connect(ctx.destination);

        const wsUrl = WS_BASE + "/ws/widget-voice";
        ws = new WebSocket(wsUrl);

        ws.onopen = function () {
          const initMsg = { type: "init" };
          if (sessionId) initMsg.sessionId = sessionId;
          ws.send(JSON.stringify(initMsg));
          callActive = true;
          setCallButtonState();
          addMessage("system", "Voice call started. You can speak.");
        };

        ws.onmessage = function (evt) {
          try {
            const msg = JSON.parse(String(evt.data));
            if (msg.type === "session" && msg.sessionId) {
              sessionId = msg.sessionId;
            } else if (msg.type === "transcript" && msg.text) {
              if (!msg.final) {
                if (!interimDiv) {
                  interimDiv = document.createElement("div");
                  interimDiv.className =
                    "furne-widget-msg furne-widget-msg-system furne-widget-msg-interim";
                  messagesEl.appendChild(interimDiv);
                }
                interimDiv.textContent = msg.text;
                messagesEl.scrollTop = messagesEl.scrollHeight;
              } else {
                if (interimDiv) {
                  interimDiv.remove();
                  interimDiv = null;
                }
                addMessage("user", msg.text);
              }
            } else if (msg.type === "agent_reply") {
              if (msg.reply) addMessage("agent", msg.reply);
              if (msg.ttsUrl) {
                const url = msg.ttsUrl + (msg.ttsUrl.includes("?") ? "&" : "?") + "_ts=" + Date.now();
                audio.src = url;
                audio.play().catch(function () {});
              }
            }
          } catch (e) {
            console.error("[FURNE widget] ws message error", e);
          }
        };

        ws.onclose = function () {
          stopCall(false);
        };

        ws.onerror = function (e) {
          console.error("[FURNE widget] ws error", e);
          addMessage("system", "Voice channel error.");
        };
      } catch (e) {
        console.error("[FURNE widget] mic error", e);
        addMessage("system", "Could not access microphone.");
      }
    }

    function stopCall(sendClose) {
      if (!callActive && !ws && !mediaStream && !audioCtx && !processor) return;

      callActive = false;
      setCallButtonState();

      if (sendClose && ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: "close" })); } catch (e) {}
      }
      if (ws) {
        try { ws.close(); } catch (e) {}
        ws = null;
      }
      if (processor) {
        try { processor.disconnect(); } catch (e) {}
        processor = null;
      }
      if (audioCtx) {
        try { audioCtx.close(); } catch (e) {}
        audioCtx = null;
      }
      if (mediaStream) {
        try {
          mediaStream.getTracks().forEach(function (t) { t.stop(); });
        } catch (e) {}
        mediaStream = null;
      }
      if (interimDiv) {
        interimDiv.remove();
        interimDiv = null;
      }
      addMessage("system", "Voice call ended.");
    }

    callBtn.addEventListener("click", function () {
      if (callActive) {
        stopCall(true);
      } else {
        startCall();
      }
    });

    // optional initial system bubble
    addMessage("system", "You are chatting with the FURNE voice agent.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWidget);
  } else {
    createWidget();
  }
})();`;
}
// ---- attach routes to existing Express app ----
export function attachWidgetRoutes(app) {
    // JS bundle
    app.get("/widget.js", (_req, res) => {
        const js = buildWidgetBundle();
        res.type("application/javascript").send(js);
    });
    // LLM + TTS endpoint
    app.post("/api/widget/message", async (req, res) => {
        try {
            const { text, sessionId } = (req.body ?? {});
            const cleaned = String(text ?? "").trim();
            if (!cleaned) {
                return res.status(400).json({ error: "text is required" });
            }
            if (cleaned.length > MAX_INPUT_CHARS) {
                return res.status(413).json({ error: "text too long" });
            }
            const sess = getOrCreateSession(sessionId);
            const reply = await sess.llm.reply(cleaned);
            const qs = new URLSearchParams({
                text: reply,
                output_format: "opus_48000_128",
            });
            if (WIDGET_VOICE_ID) {
                qs.set("voice_id", WIDGET_VOICE_ID);
            }
            const ttsUrl = `${API_BASE}/stream/tts?${qs.toString()}`;
            return res.json({
                sessionId: sess.id,
                reply,
                ttsUrl,
            });
        }
        catch (e) {
            console.error("[widget] error:", e?.message || e);
            return res.status(500).json({ error: "internal_error" });
        }
    });
}
