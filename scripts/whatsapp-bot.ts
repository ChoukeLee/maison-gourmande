/**
 * Maison Gourmande WhatsApp Bot (whatsapp-web.js)
 *
 * Uses your personal WhatsApp to chat with customers.
 * Scan the QR code to connect.
 * Run: npx tsx scripts/whatsapp-bot.ts
 */

import "dotenv/config";
import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import * as qrcode from "qrcode-terminal";
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
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr: string) => {
  console.log("\n📱 Scan this QR code with your WhatsApp:");
  qrcode.generate(qr, { small: true });
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

client.initialize();
