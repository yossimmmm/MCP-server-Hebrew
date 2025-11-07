import { randomUUID } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
/** מצמיד את MCP ל־Express קיים, ללא listen נוסף */
export function attachMcp(app, appBaseUrl) {
    const server = new McpServer({ name: "hebrew-tts-mcp", version: "1.0.0" });
    const getTtsInput = z.object({
        text: z.string().min(1, "text required"),
        voice_id: z.string().optional(),
        speed: z.number().min(0.5).max(1.5).optional(),
        model: z.string().default("eleven_v3").optional(),
        output_format: z.string().default("mp3_44100_128").optional(),
    });
    server.registerTool("get_hebrew_tts_stream_url", {
        title: "Get Hebrew TTS stream URL",
        description: "Return a URL that streams Hebrew TTS audio (HTTP chunked MP3) via ElevenLabs v3.",
        inputSchema: getTtsInput.shape,
    }, async (args) => {
        const { text, voice_id, speed, model, output_format } = args;
        const q = new URLSearchParams({
            text,
            ...(voice_id ? { voice_id } : {}),
            ...(speed != null ? { speed: String(speed) } : {}),
            ...(model ? { model } : {}),
            ...(output_format ? { output_format } : {}),
        });
        return { content: [{ type: "text", text: `${appBaseUrl}/stream/tts?${q.toString()}` }] };
    });
    server.registerResource("hebrew-tts-stream", new ResourceTemplate(`${appBaseUrl}/stream/tts?text={text}&voice_id={voice_id}&speed={speed}`, { list: undefined }), {
        title: "Hebrew TTS stream",
        description: "HTTP-chunked MP3 stream via ElevenLabs v3.",
        mimeType: "audio/mpeg",
    }, async (uri) => ({
        contents: [{ uri: uri.href, text: uri.href, mimeType: "audio/mpeg" }],
    }));
    // מסלול MCP על אותו app קיים
    app.post("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
        });
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });
    return { endpoint: `${appBaseUrl}/mcp` };
}
