import "dotenv/config";
import { createHttpApp } from "./http/app.js";
import { startMcpHttp } from "./mcp/server.js";

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const app = createHttpApp();

app.listen(PORT, async () => {
  const { endpoint } = await startMcpHttp(PUBLIC, PORT);
  console.log(`HTTP up on ${PUBLIC}`);
  console.log(`MCP endpoint: ${endpoint}`);
});
