// src/mcp/server.ts
import type express from "express";
import rawBody from "raw-body";
import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export function attachMcp(app: express.Express, appBaseUrl: string) {
  const server = new McpServer({ name: "hebrew-tts-mcp", version: "1.0.0" });

  const getTtsInput = z.object({
    text: z.string().min(1, "text required"),
    voice_id: z.string().optional(),
    speed: z.number().min(0.5).max(1.5).optional(),
    model: z.string().default("eleven_v3").optional(),
    output_format: z.string().default("mp3_44100_128").optional(),
  });

  server.registerTool(
    "get_hebrew_tts_stream_url",
    {
      title: "Get Hebrew TTS stream URL",
      description: "Return a URL that streams Hebrew TTS audio (HTTP chunked MP3) via ElevenLabs v3.",
      inputSchema: getTtsInput.shape,
    },
    async (args) => {
      const { text, voice_id, speed, model, output_format } = args as z.infer<typeof getTtsInput>;
      const q = new URLSearchParams({
        text,
        ...(voice_id ? { voice_id } : {}),
        ...(speed != null ? { speed: String(speed) } : {}),
        ...(model ? { model } : {}),
        ...(output_format ? { output_format } : {}),
      });
      return { content: [{ type: "text", text: `${appBaseUrl}/stream/tts?${q.toString()}` }] };
    }
  );

  server.registerResource(
    "hebrew-tts-stream",
    new ResourceTemplate(`${appBaseUrl}/stream/tts?text={text}&voice_id={voice_id}&speed={speed}`, { list: undefined }),
    { title: "Hebrew TTS stream", description: "HTTP-chunked MP3 stream via ElevenLabs v3.", mimeType: "audio/mpeg" },
    async (uri) => ({ contents: [{ uri: uri.href, text: uri.href, mimeType: "audio/mpeg" }] })
  );

  // בריאות/זיהוי פשוט
  app.get("/mcp", (_req, res) => {
    res.json({ ok: true, transport: "streamable-http", server: "hebrew-tts-mcp" });
  });

  // *** חשוב: לא להשתמש ב-express.json עבור /mcp ***
  app.post("/mcp", async (req, res) => {
    try {
      const accept = String(req.headers.accept || "");
      if (!(accept.includes("application/json") && accept.includes("text/event-stream"))) {
        return res.status(406).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Not Acceptable: Client must accept both application/json and text/event-stream" },
          id: null,
        });
      }

      // גוף גולמי (אל תתן ל-body parser לבלוע את הזרם)
      const buf = await rawBody(req, { encoding: "utf8", limit: "2mb" });
      let body: any = undefined;
      try { body = buf ? JSON.parse(buf) : undefined; } catch { body = undefined; }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });

      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err: any) {
      console.error("[MCP] error:", err);
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32000, message: "Internal Server Error" }, id: null });
    }
  });

  return { endpoint: `${appBaseUrl}/mcp` };
}
