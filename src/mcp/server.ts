import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export function startMcpHttp(appBaseUrl: string, port: number) {
  const app = express();
  app.use(express.json());

  const server = new McpServer({
    name: "hebrew-tts-mcp",
    version: "1.0.0",
  });

  // כלי: מחזיר URL סטרים להשמעה
  server.registerTool(
    "get_hebrew_tts_stream_url",
    {
      title: "Get Hebrew TTS stream URL",
      description:
        "Return a URL that streams Hebrew TTS audio (HTTP chunked MP3) via ElevenLabs v3.",
      inputSchema: {
        text: z.string().min(1, "text required"),
        voice_id: z.string().optional(),
        speed: z.number().min(0.5).max(1.5).optional(),
        model: z.string().default("eleven_v3").optional(),
        output_format: z.string().default("mp3_44100_128").optional(),
      },
    },
    async ({ text, voice_id, speed, model, output_format }) => {
      const q = new URLSearchParams({
        text,
        ...(voice_id ? { voice_id } : {}),
        ...(speed != null ? { speed: String(speed) } : {}),
        ...(model ? { model } : {}),
        ...(output_format ? { output_format } : {}),
      });
      const url = `${appBaseUrl}/stream/tts?${q.toString()}`;
      // הכי בטוח: להחזיר טקסט עם ה-URL
      return { content: [{ type: "text", text: url }] };
    }
  );

  // רסורס אופציונלי לגילוי
  server.registerResource(
    "hebrew-tts-stream",
    new ResourceTemplate(
      `${appBaseUrl}/stream/tts?text={text}&voice_id={voice_id}&speed={speed}`,
      { list: undefined }
    ),
    {
      title: "Hebrew TTS stream",
      description: "HTTP-chunked MP3 stream via ElevenLabs v3.",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "audio/mpeg" }] })
  );

  // נתיב MCP לפי Streamable HTTP
  app.post("/mcp", async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.log(`MCP on http://0.0.0.0:${port}/mcp`);
  });

  return { endpoint: `http://0.0.0.0:${port}/mcp` };
}
