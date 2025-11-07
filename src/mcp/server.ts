import express from "express";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

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

  // Tool: returns a playable stream URL for Hebrew TTS
  server.registerTool(
    "get_hebrew_tts_stream_url",
    {
      title: "Get Hebrew TTS stream URL",
      description:
        "Return a URL that streams Hebrew TTS audio (HTTP chunked MP3) via ElevenLabs v3.",
      // Use JSON Schema (avoids TS type issues)
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1 },
          voice_id: { type: "string" },
          speed: { type: "number", minimum: 0.5, maximum: 1.5 },
          model: { type: "string", default: "eleven_v3" },
          output_format: { type: "string", default: "mp3_44100_128" },
        },
        required: ["text"],
        additionalProperties: false,
      } as const,
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

      return { content: [{ type: "text", text: url }] };
    }
  );

  // Optional: discoverable resource template (dynamic URL)
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
    // NOTE: must return 'text' OR 'blob' with each content; include uri for fetch-capable hosts
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
