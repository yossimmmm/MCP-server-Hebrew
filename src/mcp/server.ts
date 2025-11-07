import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

/**
 * Start an MCP server over Streamable HTTP on /mcp
 */
export function startMcpHttp(appBaseUrl: string, port: number) {
  const app = express();
  app.use(express.json());

  const server = new McpServer({
    name: "hebrew-tts-mcp",
    version: "1.0.0",
  });

  // ---- Zod schema (object) + pass .shape to registerTool ----
  const getTtsInput = z.object({
    text: z.string().min(1, "text required"),
    voice_id: z.string().optional(),
    speed: z.number().min(0.5).max(1.5).optional(),
    model: z.string().default("eleven_v3").optional(),
    output_format: z.string().default("mp3_44100_128").optional(),
  });

  // Tool: returns a playable stream URL for Hebrew TTS
  server.registerTool(
    "get_hebrew_tts_stream_url",
    {
      title: "Get Hebrew TTS stream URL",
      description:
        "Return a URL that streams Hebrew TTS audio (HTTP chunked MP3) via ElevenLabs v3.",
      inputSchema: getTtsInput.shape, // <<--- ZodRawShape expected
    },
    async (args: z.infer<typeof getTtsInput>) => {
      const { text, voice_id, speed, model, output_format } = args;

      const q = new URLSearchParams({
        text,
        ...(voice_id ? { voice_id } : {}),
        ...(speed != null ? { speed: String(speed) } : {}),
        ...(model ? { model } : {}),
        ...(output_format ? { output_format } : {}),
      });

      const url = `${appBaseUrl}/stream/tts?${q.toString()}`;
      return { content: [{ type: "text", text: url }] };
    }
  );

  // Discoverable resource template (dynamic URL)
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
    // כל content חייב להכיל לפחות text או blob; מוסיפים גם uri
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: uri.href,
          mimeType: "audio/mpeg",
        },
      ],
    })
  );

  // Streamable HTTP route for MCP
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(), // נדרש ב-1.21.x
      enableJsonResponse: true,
    });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.log(`MCP on http://0.0.0.0:${port}/mcp`);
  });

  return { endpoint: `http://0.0.0.0:${port}/mcp` };
}
