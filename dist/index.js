// src/index.ts
import "dotenv/config";
import { createHttpApp } from "./http/app.js";
import { attachMcp } from "./mcp/server.js"; // <-- שים לב לשם החדש
const PORT = Number(process.env.PORT || 8080);
const PUBLIC = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const app = createHttpApp(); // יוצר את הראוט /stream/tts וכו'
attachMcp(app, PUBLIC); // מחבר את /mcp לאותו app (ללא listen נוסף)
app.listen(PORT, () => {
    console.log(`HTTP up on ${PUBLIC}`);
});
