/**
 * Maison Gourmande WhatsApp Bot (whatsapp-web.js)
 *
 * Uses your personal WhatsApp to chat with customers.
 * Scan the QR code to connect.
 * Run: npx tsx scripts/whatsapp-bot.ts
 */

import "dotenv/config";
import { Client, type Message } from "whatsapp-web.js";
import http from "node:http";
import QRCode from "qrcode";
import { chat, newConversation } from "../src/services/agent.js";

// Store per-customer sessions
const sessions = new Map<string, ReturnType<typeof newConversation>>();

function getSession(phone: string) {
  if (!sessions.has(phone)) {
    sessions.set(phone, newConversation());
  }
  return sessions.get(phone)!;
}

const client = new Client({
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

let latestQR = "";

client.on("qr", (qr: string) => {
  latestQR = qr;
  console.log("\n📱 Scan QR at: http://localhost:3457");
  console.log("  (WhatsApp → Settings → Linked Devices → Link a Device)\n");
});

client.on("ready", () => {
  console.log("✅ Maison Gourmande WhatsApp Bot is ready!");
  console.log("   Send a message to this WhatsApp number to start.\n");
});

client.on("message", async (msg: Message) => {
  // Only respond to private chats (not groups)
  if (msg.from.includes("@g.us")) return;

  const phone = msg.from;
  const text = msg.body;

  console.log(`📱 ${phone}: ${text}`);

  const session = getSession(phone);

  try {
    const result = await chat(text, session.history, session.order, session.memory);
    session.history = result.history;
    session.order = result.order;
    session.memory = result.memory;

    await msg.reply(result.reply);
    console.log(`🤖 → ${phone}: ${result.reply.slice(0, 80)}...`);
  } catch (error) {
    console.error("Chat error:", error);
    await msg.reply("Désolé, une erreur s'est produite. Veuillez réessayer.");
  }
});

// ── QR code web server ──────────────────────────
http.createServer(async (_req, res) => {
  if (!latestQR) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2 style='text-align:center;margin-top:40px;font-family:sans-serif'>Waiting for QR code...</h2><meta http-equiv='refresh' content='3'>");
    return;
  }
  const dataUrl = await QRCode.toDataURL(latestQR, { width: 280, margin: 1 });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp QR</title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f2f5;font-family:-apple-system,sans-serif}.card{background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1)}h2{font-size:16px;color:#075e54;margin-bottom:12px}img{border-radius:8px;max-width:280px}p{font-size:13px;color:#667781;margin-top:12px}</style></head><body><div class="card"><h2>Scan with WhatsApp</h2><img src="${dataUrl}" alt="QR Code"><p>WhatsApp → Settings → Linked Devices → Link a Device</p></div></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(3457, () => {
  console.log("QR page: http://localhost:3457");
});

client.initialize();
