// src/mcp/server.ts
import type express from "express";
import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export function attachMcp(app: express.Express, appBaseUrl: string) {
  // לוג בסיסי לכל בקשות MCP
  app.use((req, _res, next) => {
    if (req.path === "/mcp") {
      console.log(`[MCP] ${req.method} ${req.path}`);
    }
    next();
  });

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
    new ResourceTemplate(
      `${appBaseUrl}/stream/tts?text={text}&voice_id={voice_id}&speed={speed}`,
      { list: undefined }
    ),
    {
      title: "Hebrew TTS stream",
      description: "HTTP-chunked MP3 stream via ElevenLabs v3.",
      mimeType: "audio/mpeg",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: uri.href, mimeType: "audio/mpeg" }],
    })
  );

  // Preflight (אם הם עושים OPTIONS)
  app.options("/mcp", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization,x-mcp-secret");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.status(204).end();
  });

  // GET לבריאות/דיאגנוסטיקה (חלק מהכלים עושים GET בבדיקה)
  app.get("/mcp", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      ok: true,
      transport: "streamable-http",
      server: "hebrew-tts-mcp",
    });
  });

  // POST – Streamable HTTP
  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
      });

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.on("close", () => transport.close());

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body ?? {});
    } catch (e: any) {
      console.error("[MCP] handleRequest error:", e);
      res
        .status(500)
        .json({ error: "mcp_failed", message: e?.message || String(e) });
    }
  });

  return { endpoint: `${appBaseUrl}/mcp` };
}
