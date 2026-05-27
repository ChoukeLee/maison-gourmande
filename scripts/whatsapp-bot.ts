/**
 * Maison Gourmande WhatsApp Bot (Baileys)
 * Direct WebSocket connection, no browser needed.
 * Run: npm run whatsapp
 */

import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from "@whiskeysockets/baileys";
// qrcode does not ship TypeScript declarations in this project.
// @ts-expect-error no bundled declarations
import QRCode from "qrcode";
import fs from "node:fs/promises";
import http from "node:http";
import { pipeline } from "@xenova/transformers";
import { OggOpusDecoder } from "ogg-opus-decoder";
import { chat, newConversation } from "../src/services/agent.js";
import { getAdminMenuItems } from "../src/services/menu-search.js";
import { detectMenuImageRequest, renderMenuImageSvg, titleForMenuImage } from "../src/server/menu-image.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { Order } from "../src/types/order.js";
import { OrderSource } from "../src/types/order.js";
import type { ConversationMemory } from "../src/types/memory.js";

// Local Whisper transcriber (lazy init — downloads ~150MB model on first use)
let transcriber: any = null;
async function transcribe(audioPath: string): Promise<string> {
  if (!transcriber) {
    console.log("Loading local Whisper model (first time ~30s)...");
    transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
      quantized: true,
    });
    console.log("Whisper model ready ✓");
  }
  // Decode OGG/Opus → raw PCM samples
  const oggBuf = await fs.readFile(audioPath);
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  const decoded = await decoder.decodeFile(oggBuf) as any;
  // decoded.samples is a Float32Array, decoded.sampleRate is the sample rate
  const audio = decoded.samples;
  const sampleRate = decoded.sampleRate as number;

  // Resample to 16kHz if needed
  let audio16k = audio;
  if (sampleRate !== 16000) {
    audio16k = resample(audio, sampleRate, 16000);
  }

  const result = await transcriber(audio16k);
  return result.text as string;
}

// Simple resampling (linear interpolation)
function resample(data: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = fromRate / toRate;
  const newLen = Math.floor(data.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i * ratio;
    const srcFloor = Math.floor(srcIdx);
    const srcCeil = Math.min(srcFloor + 1, data.length - 1);
    const frac = srcIdx - srcFloor;
    result[i] = data[srcFloor]! * (1 - frac) + data[srcCeil]! * frac;
  }
  return result;
}

// Per-customer sessions
const sessions = new Map<string, { history: MessageParam[]; order: Order; memory: ConversationMemory }>();

function getSession(phone: string) {
  if (!sessions.has(phone)) {
    sessions.set(phone, newConversation());
  }
  return sessions.get(phone)!;
}

// QR code state
let latestQR = "";

// Start the HTTP QR server
http.createServer(async (_req, res) => {
  if (!latestQR) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2 style='text-align:center;margin-top:40px;font-family:sans-serif'>Generating QR...</h2><meta http-equiv='refresh' content='3'>");
    return;
  }
  const dataUrl = await QRCode.toDataURL(latestQR, { width: 280, margin: 1 });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp QR</title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f2f5;font-family:-apple-system,sans-serif}.card{background:#fff;border-radius:12px;padding:24px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.1)}h2{font-size:16px;color:#075e54;margin-bottom:12px}img{border-radius:8px;max-width:280px}p{font-size:13px;color:#667781;margin-top:12px}</style></head><body><div class="card"><h2>Scan with WhatsApp</h2><img src="${dataUrl}" alt="QR Code"><p>WhatsApp → Linked Devices → Link a Device</p></div></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(3457, () => {
  console.log("QR page: http://localhost:3457");
});

// Connect to WhatsApp
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(".baileys_auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      console.log("📱 New QR generated — open http://localhost:3457");
    }

    if (connection === "open") {
      console.log("✅ Maison Gourmande WhatsApp Bot is ready!");
      console.log("   Send a message to this WhatsApp number to start.\n");
    }

    if (connection === "close") {
      const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed. Reconnecting:", shouldReconnect);
      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg?.message || msg.key.fromMe) return;

    const phone = msg.key.remoteJid!;
    if (phone.includes("@g.us")) return; // skip groups

    let text = msg.message.conversation || msg.message.extendedTextMessage?.text;

    // Handle voice/audio messages
    if (!text && msg.message.audioMessage) {
      console.log(`🎤 Voice message from ${phone.split("@")[0]}, transcribing...`);
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
        const tmpPath = `.baileys_auth/voice_${Date.now()}.ogg`;
        await fs.writeFile(tmpPath, buffer);

        text = await transcribe(tmpPath);

        // Clean up temp file
        fs.unlink(tmpPath).catch(() => {});

        console.log(`🎤 Transcribed: "${text}"`);
      } catch (e) {
        console.error("Transcription failed:", e);
        await sock.sendMessage(phone, { text: "Désolé, je n'ai pas compris le message vocal. Pouvez-vous écrire ?" });
        return;
      }
    }

    if (!text) return;

    console.log(`📱 ${phone.split("@")[0]}: ${text}`);

    const session = getSession(phone);
    session.order.source = OrderSource.WHATSAPP;

    try {
      const menuImageRequest = detectMenuImageRequest(text);
      if (menuImageRequest) {
        const items = getAdminMenuItems()
          .filter(item => !item.hidden)
          .filter(item => !menuImageRequest.category || item.category === menuImageRequest.category)
          .filter(item => !menuImageRequest.recommended || item.recommended)
          .sort((a, b) => Number(b.recommended) - Number(a.recommended) || (a.price ?? 0) - (b.price ?? 0));
        const title = titleForMenuImage(menuImageRequest.category, menuImageRequest.recommended);
        const svg = renderMenuImageSvg({ ...title, items });

        await sock.sendMessage(phone, { text: "Bien sûr. Voici la carte actuelle." });
        await sock.sendMessage(phone, {
          document: Buffer.from(svg, "utf8"),
          mimetype: "image/svg+xml",
          fileName: "maison-gourmande-menu.svg",
        });
        console.log(`ðŸ–¼ï¸ â†’ ${phone.split("@")[0]}: menu image sent`);
        return;
      }

      const result = await chat(text, session.history, session.order, session.memory);
      session.history = result.history;
      session.order = result.order;
      session.memory = result.memory;

      await sock.sendMessage(phone, { text: result.reply });
      console.log(`🤖 → ${phone.split("@")[0]}: ${result.reply.slice(0, 80)}...`);
    } catch (error) {
      console.error("Chat error:", error);
      await sock.sendMessage(phone, { text: "Désolé, une erreur s'est produite. Veuillez réessayer." });
    }
  });
}

startBot();
