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
import { getAdminMenuItems } from "../services/menu-search.js";
import { detectMenuImageRequest, renderMenuImageSvg, titleForMenuImage } from "./menu-image.js";
import { updateMenuOverride } from "./menu-override-store.js";
import { loadOrderQueue, saveOrderQueue } from "./order-store.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { Order } from "../types/order.js";
import {
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PosStatus,
} from "../types/order.js";
import { MenuCategory } from "../types/menu.js";
import type { QueuedOrder } from "../types/queued-order.js";
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
app.get("/admin", (_req, res) => { res.sendFile("staff.html", { root: publicDir }); });

app.get("/api/menu-image.svg", (req, res) => {
  const category = req.query["category"] as MenuCategory | undefined;
  const recommended = req.query["recommended"] === "true";
  const items = getMenuImageItems(category, recommended);
  const title = titleForMenuImage(category, recommended);
  res.type("image/svg+xml").send(renderMenuImageSvg({
    ...title,
    items,
  }));
});

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
const orderQueue: QueuedOrder[] = await loadOrderQueue();

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
    storeId: order.storeId,
    source: order.source,
    orderType: order.orderType,
    tableNumber: order.tableNumber,
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
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    posStatus: order.posStatus,
    note: order.note,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// Push order to queue and notify staff
async function pushToQueue(order: Order): Promise<QueuedOrder> {
  const qo = orderToQueued(order);
  // Replace if exists (status update), otherwise add
  const idx = orderQueue.findIndex(o => o.id === qo.id);
  if (idx >= 0) {
    orderQueue[idx] = qo;
  } else {
    orderQueue.unshift(qo); // newest first
  }
  await saveOrderQueue(orderQueue);
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
    const {
      message,
      sessionId,
      tableNumber,
      orderType,
      source,
    } = req.body as {
      message: string;
      sessionId: string;
      tableNumber?: string;
      orderType?: OrderType;
      source?: OrderSource;
    };
    if (!message || !sessionId) {
      res.status(400).json({ error: "message and sessionId are required" });
      return;
    }
    if (orderType !== undefined && !Object.values(OrderType).includes(orderType)) {
      res.status(400).json({ error: "Invalid orderType" });
      return;
    }
    if (source !== undefined && !Object.values(OrderSource).includes(source)) {
      res.status(400).json({ error: "Invalid source" });
      return;
    }

    const session = getSession(sessionId);
    if (tableNumber !== undefined) {
      session.order.tableNumber = String(tableNumber).trim() || undefined;
    }
    if (orderType !== undefined) {
      session.order.orderType = orderType;
    }
    if (source !== undefined) {
      session.order.source = source;
    }

    const menuImageUrl = getMenuImageUrlForMessage(message);
    if (menuImageUrl) {
      res.json({
        reply: "Bien sûr. Voici la carte actuelle.",
        menuImageUrl,
        order: {
          items: session.order.items.map(item => ({
            id: item.menuItemId,
            name: item.name,
            nameZh: item.nameZh,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            option: item.selectedOption,
            note: item.note,
            subtotal: item.unitPrice * item.quantity,
          })),
          total: session.order.total,
          itemCount: session.order.itemCount,
          status: session.order.status,
          id: session.order.id,
          tableNumber: session.order.tableNumber,
          orderType: session.order.orderType,
          source: session.order.source,
        },
      });
      return;
    }

    const wasDraft = session.order.status === OrderStatus.DRAFT;

    const result = await chat(message, session.history, session.order, session.memory);
    session.history = result.history;
    session.order = result.order;
    session.memory = result.memory;

    // Detect fresh confirmation — push to staff queue
    if (wasDraft && result.order.status === OrderStatus.CONFIRMED) {
      await pushToQueue(result.order);
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
      order: {
        items: orderItems,
        total: result.order.total,
        itemCount: result.order.itemCount,
        status: result.order.status,
        id: result.order.id,
        tableNumber: result.order.tableNumber,
        orderType: result.order.orderType,
        source: result.order.source,
      },
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

app.patch("/api/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status: OrderStatus };

  const qo = orderQueue.find(o => o.id === id);
  if (!qo) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  if (!Object.values(OrderStatus).includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  qo.status = status;
  qo.updatedAt = Date.now();
  await saveOrderQueue(orderQueue);
  broadcastSSE("order_updated", qo);
  res.json(qo);
});

app.patch("/api/orders/:id/cashier", async (req, res) => {
  const { id } = req.params;
  const {
    paymentStatus,
    paymentMethod,
    posStatus,
  } = req.body as {
    paymentStatus?: PaymentStatus;
    paymentMethod?: PaymentMethod;
    posStatus?: PosStatus;
  };

  const qo = orderQueue.find(o => o.id === id);
  if (!qo) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  if (paymentStatus !== undefined && !Object.values(PaymentStatus).includes(paymentStatus)) {
    res.status(400).json({ error: "Invalid paymentStatus" });
    return;
  }
  if (paymentMethod !== undefined && !Object.values(PaymentMethod).includes(paymentMethod)) {
    res.status(400).json({ error: "Invalid paymentMethod" });
    return;
  }
  if (posStatus !== undefined && !Object.values(PosStatus).includes(posStatus)) {
    res.status(400).json({ error: "Invalid posStatus" });
    return;
  }

  if (paymentStatus !== undefined) qo.paymentStatus = paymentStatus;
  if (paymentMethod !== undefined) qo.paymentMethod = paymentMethod;
  if (posStatus !== undefined) qo.posStatus = posStatus;
  qo.updatedAt = Date.now();

  await saveOrderQueue(orderQueue);
  broadcastSSE("order_updated", qo);
  res.json(qo);
});

app.post("/api/admin/assistant", (req, res) => {
  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  res.json({ reply: answerAdminQuestion(message, orderQueue) });
});

app.get("/api/admin/menu", (_req, res) => {
  res.json({
    items: getAdminMenuItems(),
  });
});

app.patch("/api/admin/menu/:id", (req, res) => {
  const { id } = req.params;
  const baseItem = getAdminMenuItems().find(item => item.id === id);
  if (!baseItem) {
    res.status(404).json({ error: "Menu item not found" });
    return;
  }

  const { price, soldOut, hidden, recommended, note } = req.body as {
    price?: number | null;
    soldOut?: boolean;
    hidden?: boolean;
    recommended?: boolean;
    note?: string;
  };

  if (price !== undefined && price !== null && (!Number.isFinite(price) || price < 0)) {
    res.status(400).json({ error: "Invalid price" });
    return;
  }

  const override = updateMenuOverride(id, {
    price,
    soldOut,
    hidden,
    recommended,
    note,
  });

  res.json({
    item: getAdminMenuItems().find(item => item.id === id),
    override,
  });
});

function answerAdminQuestion(message: string, orders: QueuedOrder[]): string {
  const text = message.toLowerCase();
  const active = orders.filter(o => o.status !== OrderStatus.COMPLETED && o.status !== OrderStatus.CANCELLED);
  const salesOrders = orders.filter(o => o.status !== OrderStatus.CANCELLED);
  const sales = salesOrders.reduce((sum, o) => sum + o.total, 0);
  const unpaid = salesOrders.filter(o => o.paymentStatus !== PaymentStatus.PAID);
  const posOpen = salesOrders.filter(o => o.posStatus !== PosStatus.ENTERED);

  if (matchesAny(text, ["sales", "revenue", "turnover", "chiffre", "vente", "销售", "营收"])) {
    const avg = salesOrders.length ? Math.round(sales / salesOrders.length) : 0;
    return `Today's sales are ${formatFcfa(sales)} across ${salesOrders.length} orders. Average ticket: ${formatFcfa(avg)}.`;
  }

  if (matchesAny(text, ["unpaid", "payment", "cashier", "payer", "paiement", "收款", "付款"])) {
    if (unpaid.length === 0) return "All current orders are marked paid.";
    return `There are ${unpaid.length} orders still awaiting payment: ${unpaid.map(o => `#${o.id} (${formatFcfa(o.total)})`).join(", ")}.`;
  }

  if (matchesAny(text, ["pos", "entered", "录入", "收银机", "caisse"])) {
    if (posOpen.length === 0) return "All current orders are marked as entered in the POS.";
    return `${posOpen.length} orders still need POS entry: ${posOpen.map(o => `#${o.id}`).join(", ")}.`;
  }

  if (matchesAny(text, ["kitchen", "ready", "preparing", "cuisine", "厨房", "制作"])) {
    const confirmed = active.filter(o => o.status === OrderStatus.CONFIRMED).length;
    const preparing = active.filter(o => o.status === OrderStatus.PREPARING).length;
    const ready = active.filter(o => o.status === OrderStatus.READY).length;
    return `Kitchen queue: ${confirmed} new, ${preparing} preparing, ${ready} ready.`;
  }

  if (matchesAny(text, ["top", "popular", "best", "hot", "热卖", "卖得好"])) {
    const topItems = getTopItems(salesOrders).slice(0, 5);
    if (topItems.length === 0) return "No item sales yet today.";
    return `Top items today: ${topItems.map(i => `${i.name} x${i.quantity}`).join(", ")}.`;
  }

  if (matchesAny(text, ["menu", "price", "sold out", "available", "菜单", "价格", "售罄"])) {
    return "Menu editing is the next module. For safety, I will only change prices or availability after the Menu tools are connected and every change can be reviewed before saving.";
  }

  return "I can help with today's sales, unpaid orders, POS entry, kitchen queue, and top items. Soon I will also help edit menu prices, sold-out status, and WhatsApp menu templates after review.";
}

function matchesAny(text: string, terms: string[]): boolean {
  return terms.some(term => text.includes(term));
}

function formatFcfa(value: number): string {
  return `${value.toLocaleString("fr-FR")} FCFA`;
}

function getTopItems(orders: QueuedOrder[]): { name: string; quantity: number }[] {
  const itemMap = new Map<string, { name: string; quantity: number }>();
  for (const order of orders) {
    for (const item of order.items) {
      const existing = itemMap.get(item.name) ?? { name: item.name, quantity: 0 };
      existing.quantity += item.quantity;
      itemMap.set(item.name, existing);
    }
  }
  return [...itemMap.values()].sort((a, b) => b.quantity - a.quantity);
}

function getMenuImageItems(category?: MenuCategory, recommended?: boolean) {
  return getAdminMenuItems()
    .filter(item => !item.hidden)
    .filter(item => !category || item.category === category)
    .filter(item => !recommended || item.recommended)
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || (a.price ?? 0) - (b.price ?? 0));
}

function getMenuImageUrlForMessage(message: string): string | null {
  const menuImageRequest = detectMenuImageRequest(message);
  if (!menuImageRequest) return null;
  const query = new URLSearchParams();
  if (menuImageRequest.category) query.set("category", menuImageRequest.category);
  if (menuImageRequest.recommended) query.set("recommended", "true");
  return `/api/menu-image.svg?${query.toString()}`;
}

function getPublicUrl(req: express.Request, localPath: string): string {
  const configuredBase = process.env["PUBLIC_BASE_URL"];
  if (configuredBase) return new URL(localPath, configuredBase).toString();
  const proto = req.headers["x-forwarded-proto"]?.toString() ?? req.protocol;
  const host = req.headers["x-forwarded-host"]?.toString() ?? req.get("host");
  return `${proto}://${host}${localPath}`;
}

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

// Diagnostic: last received webhook payload
let lastWebhook: { time: string; body: unknown } | null = null;

app.get("/api/whatsapp/debug", (_req, res) => {
  res.json({ lastWebhook, serverTime: new Date().toISOString() });
});

// POST — incoming WhatsApp messages
app.post("/api/whatsapp/webhook", async (req, res) => {
  try {
    const body = req.body;
    lastWebhook = { time: new Date().toISOString(), body };
    console.log("📱 WhatsApp webhook received:", JSON.stringify(body).slice(0, 200));

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
    session.order.source = OrderSource.WHATSAPP;

    const menuImageUrl = getMenuImageUrlForMessage(text);
    if (menuImageUrl) {
      const absoluteUrl = getPublicUrl(req, menuImageUrl);
      await sendWhatsAppMessage(from, "Bien sûr. Voici la carte actuelle.");
      await sendWhatsAppImageMessage(from, absoluteUrl, "Maison Gourmande menu");
      res.sendStatus(200);
      return;
    }

    const result = await chat(text, session.history, session.order, session.memory);
    session.history = result.history;
    session.order = result.order;
    session.memory = result.memory;

    // Detect fresh confirmation
    if (session.order.status === OrderStatus.CONFIRMED) {
      await pushToQueue(session.order);
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

async function sendWhatsAppImageMessage(to: string, imageUrl: string, caption: string) {
  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_ID) {
    console.log(`[WhatsApp would send image to ${to}]: ${imageUrl}`);
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
          type: "image",
          image: {
            link: imageUrl,
            caption,
          },
        }),
      }
    );
    const data = await resp.json();
    if (!resp.ok) {
      console.error("WhatsApp image send error:", JSON.stringify(data));
    }
  } catch (error) {
    console.error("WhatsApp image send failed:", error);
  }
}

// ============================================================================
// Start
// ============================================================================
const PORT = process.env["PORT"] ?? 3456;
app.listen(PORT, () => {
  console.log(`\n  🍽️  Maison Gourmande`);
  console.log(`  Chat:    http://localhost:${PORT}`);
  console.log(`  Kitchen: http://localhost:${PORT}/staff`);
  console.log(`  Orders:  ${orderQueue.length} loaded from store`);
  if (WHATSAPP_ACCESS_TOKEN) {
    console.log(`  WhatsApp webhook ready ✓`);
  } else {
    console.log(`  WhatsApp: set WHATSAPP_ACCESS_TOKEN to enable`);
  }
  console.log("");
});
