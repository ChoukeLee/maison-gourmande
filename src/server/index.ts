/**
 * Maison Gourmande — Local Web Server
 *
 * Serves chat UI, staff kitchen display, and API endpoints.
 * Run: npm run serve
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { chat, newConversation } from "../services/agent.js";
import { advanceStatus } from "../services/order-engine.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { Order } from "../types/order.js";
import { OrderStatus } from "../types/order.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ConversationMemory } from "../types/memory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../../public");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));
app.get("/staff", (_req, res) => { res.sendFile("staff.html", { root: publicDir }); });

// ============================================================================
// Session store (customer chat sessions)
// ============================================================================
const sessions = new Map<string, { history: MessageParam[]; order: Order; memory: ConversationMemory }>();

function getSession(sessionId: string) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, newConversation());
  }
  return sessions.get(sessionId)!;
}

// ============================================================================
// Order queue (confirmed orders for staff)
// ============================================================================
interface QueuedOrder {
  id: string;
  items: { name: string; nameZh?: string; quantity: number; unitPrice: number; option?: string; note?: string; subtotal: number }[];
  total: number;
  itemCount: number;
  status: OrderStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

const orderQueue: QueuedOrder[] = [];

// SSE clients for real-time staff notifications
const sseClients: Set<express.Response> = new Set();

function broadcastSSE(event: string, data: unknown) {
  const json = JSON.stringify(data);
  for (const client of sseClients) {
    client.write(`event: ${event}\ndata: ${json}\n\n`);
  }
}

function orderToQueued(order: Order): QueuedOrder {
  return {
    id: order.id,
    items: order.items.map(i => ({
      name: i.name,
      nameZh: i.nameZh,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      option: i.selectedOption,
      note: i.note,
      subtotal: i.unitPrice * i.quantity,
    })),
    total: order.total,
    itemCount: order.itemCount,
    status: order.status,
    note: order.note,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// Push order to queue and notify staff
function pushToQueue(order: Order): QueuedOrder {
  const qo = orderToQueued(order);
  // Replace if exists (status update), otherwise add
  const idx = orderQueue.findIndex(o => o.id === qo.id);
  if (idx >= 0) {
    orderQueue[idx] = qo;
  } else {
    orderQueue.unshift(qo); // newest first
  }
  broadcastSSE("new_order", qo);
  console.log(`\n🔔 NEW ORDER #${qo.id}`);
  console.log(`   ${qo.items.map(i => `${i.name} x${i.quantity}`).join(", ")}`);
  console.log(`   Total: ${qo.total.toLocaleString()} FCFA\n`);
  return qo;
}

// ============================================================================
// Chat API
// ============================================================================
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId } = req.body as { message: string; sessionId: string };
    if (!message || !sessionId) {
      res.status(400).json({ error: "message and sessionId are required" });
      return;
    }

    const session = getSession(sessionId);
    const wasDraft = session.order.status === OrderStatus.DRAFT;

    const result = await chat(message, session.history, session.order, session.memory);
    session.history = result.history;
    session.order = result.order;
    session.memory = result.memory;

    // Detect fresh confirmation — push to staff queue
    if (wasDraft && result.order.status === OrderStatus.CONFIRMED) {
      pushToQueue(result.order);
    }

    const orderItems = result.order.items.map(item => ({
      id: item.menuItemId,
      name: item.name,
      nameZh: item.nameZh,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      option: item.selectedOption,
      note: item.note,
      subtotal: item.unitPrice * item.quantity,
    }));

    res.json({
      reply: result.reply,
      order: { items: orderItems, total: result.order.total, itemCount: result.order.itemCount, status: result.order.status, id: result.order.id },
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal error" });
  }
});

// ============================================================================
// Staff API — SSE stream
// ============================================================================
app.get("/api/orders/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("\n");

  sseClients.add(res);

  // Send current queue as initial state
  res.write(`event: init\ndata: ${JSON.stringify(orderQueue)}\n\n`);

  req.on("close", () => {
    sseClients.delete(res);
  });
});

// ============================================================================
// Staff API — order list + status management
// ============================================================================
app.get("/api/orders", (_req, res) => {
  res.json(orderQueue);
});

app.patch("/api/orders/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status: OrderStatus };

  const qo = orderQueue.find(o => o.id === id);
  if (!qo) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  qo.status = status;
  qo.updatedAt = Date.now();
  broadcastSSE("order_updated", qo);
  res.json(qo);
});

// ============================================================================
// WhatsApp Webhook (Cloud API)
// ============================================================================
const WHATSAPP_VERIFY_TOKEN = process.env["WHATSAPP_VERIFY_TOKEN"] ?? "mg-whatsapp-token-2026";
const WHATSAPP_ACCESS_TOKEN = process.env["WHATSAPP_ACCESS_TOKEN"] ?? "";
const WHATSAPP_PHONE_ID = process.env["WHATSAPP_PHONE_ID"] ?? "";

// GET — Meta verification challenge
app.get("/api/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WHATSAPP_VERIFY_TOKEN) {
    console.log("WhatsApp webhook verified ✓");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// POST — incoming WhatsApp messages
app.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages?.length) {
      res.sendStatus(200); // ack silently
      return;
    }

    const message = messages[0];
    // Only handle text messages
    if (message.type !== "text") {
      res.sendStatus(200);
      return;
    }

    const from = message.from; // phone number, e.g. "2250708959999"
    const text = message.text.body;

    console.log(`📱 WhatsApp from ${from}: ${text}`);

    // Use phone number as the session key
    const session = getSession(from);

    const result = await chat(text, session.history, session.order, session.memory);
    session.history = result.history;
    session.order = result.order;
    session.memory = result.memory;

    // Detect fresh confirmation
    if (session.order.status === OrderStatus.CONFIRMED) {
      pushToQueue(session.order);
    }

    // Send reply back to WhatsApp
    await sendWhatsAppMessage(from, result.reply);

    res.sendStatus(200);
  } catch (error) {
    console.error("WhatsApp webhook error:", error);
    res.sendStatus(200); // Always return 200 to prevent Meta retries
  }
});

// Send a WhatsApp message via Cloud API
async function sendWhatsAppMessage(to: string, text: string) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_ID) {
    console.log(`[WhatsApp would send to ${to}]: ${text.slice(0, 80)}...`);
    return;
  }

  try {
    const resp = await fetch(
      `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: text },
        }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      console.error("WhatsApp send error:", JSON.stringify(data));
    }
  } catch (error) {
    console.error("WhatsApp send failed:", error);
  }
}

// ============================================================================
// Start
// ============================================================================
const PORT = 3456;
app.listen(PORT, () => {
  console.log(`\n  🍽️  Maison Gourmande`);
  console.log(`  Chat:    http://localhost:${PORT}`);
  console.log(`  Kitchen: http://localhost:${PORT}/staff`);
  if (WHATSAPP_ACCESS_TOKEN) {
    console.log(`  WhatsApp webhook ready ✓`);
  } else {
    console.log(`  WhatsApp: set WHATSAPP_ACCESS_TOKEN to enable`);
  }
  console.log("");
});
