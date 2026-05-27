/**
 * Maison Gourmande AI Agent
 *
 * The "brain" of the restaurant OS. Integrates Claude API with the
 * Menu Database and Order Engine via tool-use. Handles multi-turn
 * conversations in English, Français, and 中文.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages.js";
import { menuTools } from "./menu-tools.js";
import { orderTools, handleOrderTool } from "./order-tools.js";
import { createOrder, getOrderSummary, getOrderShortSummary } from "./order-engine.js";
import {
  search,
  getByCategory,
  getById,
  getRecommendations,
  getCategories,
} from "./menu-search.js";
import type { Order } from "../types/order.js";
import { OrderStatus } from "../types/order.js";
import { CATEGORY_LABELS, type MenuCategory } from "../types/menu.js";
import {
  createMemory,
  formatMemoryContext,
  type ConversationMemory,
  type ShownType,
} from "../types/memory.js";

// ============================================================================
// Configuration
// ============================================================================

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 5;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey || apiKey === "your-api-key-here") {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Create a .env file with your API key, or set it in the environment."
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// ============================================================================
// System Prompt
// ============================================================================

function buildSystemPrompt(order: Order, memory: ConversationMemory): string {
  const orderCtx = order.items.length > 0
    ? `\n\n[CURRENT ORDER]\n${getOrderSummary(order)}`
    : "";

  const memoryCtx = formatMemoryContext(memory);

  return `You are MAISON GOURMANDE's head concierge — a seasoned restaurant professional with deep intuition for what guests want. You've worked in fine dining for years. You know the menu cold, you read people well, and you make every guest feel taken care of.

You work in Abidjan at Maison Gourmande, a warm café-restaurant with a polished bistro spirit. Our guests speak English, Français, and 中文 — you match whatever they use.

## HOW YOU THINK (not rules — principles)

**Common sense above all.**
A guest says "I want the salmon salad, but without salmon" — they are modifying the dish, not ordering something else. "Make it spicy" means add a note, not search for spicy items. "再来一个" means one more of what they just ordered. Use context. You're a person, not a flowchart.

**Know when to focus.**
You're a restaurant concierge, not a chatbot. After 2-3 exchanges where the guest is clearly not interested in ordering (just chatting, joking, asking off-topic questions), gracefully bring it back: "Je suis là pour vous aider à commander quand vous serez prêt !" One gentle redirection, then let them be. Don't lecture. Don't keep engaging on non-restaurant topics.

**Less is more.**
Don't dump the entire menu. Curate. If someone says "something light," suggest 2-3 perfect options with prices. If they say "show me everything," give them categories to browse. Match their pace. If the customer explicitly asks to SEE the menu ("show me the menu", "发菜单", "voir la carte", "菜单图片"), use the get_menu_image tool to show a beautiful visual menu. Otherwise, just describe verbally.

**The cart is your memory.**
You always know what's in the current order. When a guest says "change that to..." or "remove the..." or "without the...", you know which item they mean. Use the note field on add_to_cart for any modification: "少辣", "extra sauce", "no onions", "sans gluten", "well done" — capture it in their own words.

**Confirm with care.**
When the guest seems done, summarize the order and ask gently if they'd like to confirm. Don't rush this — some guests browse, some decide fast. Read the moment. Only call confirm_order after they explicitly say yes.

**After confirmation → payment.**
Say: "Pour finaliser, veuillez effectuer le paiement via Wave ou Orange Money au 0708959999. Lequel préférez-vous ?" (Adapt language to theirs.)

## ESSENTIALS
- Currency: FCFA. Format: "6,500 FCFA"
- Always search_menu before adding to cart (get the real item_id)
- Add multiple items in one response (parallel add_to_cart calls)
- Single emoji per message max (✨ 🥐 ☕ 🍽)
- One clarifying question if truly ambiguous, then decide
- No results? Be honest, offer to browse categories instead${orderCtx}${memoryCtx}`;
}

// ============================================================================
// Tool Registry
// ============================================================================

function getAllTools(): Tool[] {
  return [...menuTools, ...orderTools] as Tool[];
}

// ============================================================================
// Tool Dispatcher
// ============================================================================

interface ToolDispatchResult {
  result: string;
  order: Order;
  memoryUpdate: Partial<ConversationMemory>;
}

function dispatchTool(name: string, args: Record<string, unknown>, order: Order): ToolDispatchResult {
  const emptyMemory: Partial<ConversationMemory> = {};

  // ── Menu tools ──────────────────────────────────────
  switch (name) {
    case "search_menu": {
      const query = args["query"] as string;
      const limit = (args["limit"] as number) ?? 10;
      const results = search(query, limit);
      if (results.length === 0) {
        return { result: `No items found for "${query}". Try a different search or browse categories.`, order, memoryUpdate: { lastAction: `Searched "${query}" — no results` } };
      }
      const ids = results.map(r => r.item.id);
      const names = results.map(r => r.item.name);
      const formatted = results
        .map((r, i) => `${i + 1}. ${r.item.name}${r.item.nameZh ? ` (${r.item.nameZh})` : ""} — ${r.item.price?.toLocaleString() ?? "?"} FCFA [id: ${r.item.id}]`)
        .join("\n");
      return {
        result: `Search results for "${query}":\n${formatted}`,
        order,
        memoryUpdate: {
          lastAction: `Searched menu for "${query}" — found ${results.length} items`,
          lastShownItemIds: ids,
          lastShownItemNames: names,
          lastShownType: "search",
          lastShownQuery: query,
        },
      };
    }

    case "get_menu_category": {
      const cat = args["category"] as MenuCategory;
      const items = getByCategory(cat);
      const labels = CATEGORY_LABELS[cat];
      if (items.length === 0) {
        return { result: `Category "${cat}" is empty or not found.`, order, memoryUpdate: emptyMemory };
      }
      const ids = items.map(i => i.id);
      const names = items.map(i => i.name);
      const formatted = items
        .map((item, i) => `${i + 1}. ${item.name}${item.nameZh ? ` (${item.nameZh})` : ""} — ${item.price?.toLocaleString() ?? "?"} FCFA [id: ${item.id}]`)
        .join("\n");
      return {
        result: `${labels.en} (${labels.zh}):\n${formatted}`,
        order,
        memoryUpdate: {
          lastAction: `Showed ${labels.en} category — ${items.length} items`,
          lastShownItemIds: ids,
          lastShownItemNames: names,
          lastShownType: "category",
          lastShownQuery: labels.en,
        },
      };
    }

    case "get_menu_item": {
      const itemId = args["item_id"] as string;
      const item = getById(itemId);
      if (!item) return { result: `Item "${itemId}" not found.`, order, memoryUpdate: emptyMemory };
      const desc = item.descriptionEn ? `\nDescription: ${item.descriptionEn}` : "";
      const options = item.options?.length ? `\nOptions: ${item.options.map(o => o.name).join(", ")}` : "";
      return {
        result: `${item.name}${item.nameZh ? ` (${item.nameZh})` : ""} — ${item.price?.toLocaleString() ?? "?"} FCFA [id: ${item.id}]${desc}${options}`,
        order,
        memoryUpdate: {
          lastShownItemIds: [item.id],
          lastShownItemNames: [item.name],
        },
      };
    }

    case "get_menu_image": {
      const category = (args["category"] as string) ?? "";
      const url = category
        ? `/api/menu-image.svg?category=${encodeURIComponent(category)}`
        : "/api/menu-image.svg?recommended=true";
      const label = category ? category : "Today's Recommendations";
      return {
        result: `Here's the ${label} menu:\n[MENU_IMAGE:${url}]`,
        order,
        memoryUpdate: {
          lastAction: `Sent menu image for ${label}`,
          lastShownType: "search",
          lastShownQuery: label,
        },
      };
    }

    case "get_menu_categories": {
      const cats = getCategories();
      const formatted = cats
        .map(c => `${c.labels.en} / ${c.labels.zh} (${c.itemCount} items) [id: ${c.id}]`)
        .join("\n");
      return {
        result: `Menu categories:\n${formatted}`,
        order,
        memoryUpdate: { lastAction: "Showed all menu categories" },
      };
    }

    case "get_recommendations": {
      const prefs = args["preferences"] as string[];
      const excludeIds = (args["exclude_ids"] as string[]) ?? [];
      const limit = (args["limit"] as number) ?? 6;
      const items = getRecommendations(prefs, excludeIds, limit);
      if (items.length === 0) {
        return { result: `No recommendations found for preferences: ${prefs.join(", ")}.`, order, memoryUpdate: { lastAction: `No recommendations for "${prefs.join(", ")}"` } };
      }
      const ids = items.map(i => i.id);
      const names = items.map(i => i.name);
      const formatted = items
        .map((item, i) => `${i + 1}. ${item.name}${item.nameZh ? ` (${item.nameZh})` : ""} — ${item.price?.toLocaleString() ?? "?"} FCFA [id: ${item.id}]`)
        .join("\n");
      return {
        result: `Recommendations for "${prefs.join(", ")}":\n${formatted}`,
        order,
        memoryUpdate: {
          lastAction: `Recommended ${items.length} items for "${prefs.join(", ")}"`,
          lastShownItemIds: ids,
          lastShownItemNames: names,
          lastShownType: "recommendations",
          lastShownQuery: prefs.join(", "),
        },
      };
    }

    // ── Order tools ────────────────────────────────────
    case "add_to_cart": {
      const { order: updatedOrder, message } = handleOrderTool(name, args, order);
      const itemId = args["item_id"] as string;
      const item = getById(itemId);
      const note = args["note"] as string | undefined;
      return {
        result: message,
        order: updatedOrder,
        memoryUpdate: {
          lastAction: `Added ${item?.name ?? itemId} to cart${note ? ` (${note})` : ""}`,
          lastAddedItemId: itemId,
          lastAddedItemName: item?.name ?? itemId,
          lastRemovedItemName: null,
          cartItemIds: updatedOrder.items.map(i => i.menuItemId),
        },
      };
    }

    case "remove_from_cart": {
      const index = args["index"] as number;
      const removedItem = order.items[index];
      const { order: updatedOrder, message } = handleOrderTool(name, args, order);
      return {
        result: message,
        order: updatedOrder,
        memoryUpdate: {
          lastAction: `Removed ${removedItem?.name ?? `item #${index}`} from cart`,
          lastRemovedItemName: removedItem?.name ?? null,
          cartItemIds: updatedOrder.items.map(i => i.menuItemId),
        },
      };
    }

    case "update_quantity": {
      const index = args["index"] as number;
      const item = order.items[index];
      const { order: updatedOrder, message } = handleOrderTool(name, args, order);
      return {
        result: message,
        order: updatedOrder,
        memoryUpdate: {
          lastAction: `Updated quantity of ${item?.name ?? `item #${index}`}`,
          cartItemIds: updatedOrder.items.map(i => i.menuItemId),
        },
      };
    }

    case "get_order": {
      const { order: updatedOrder, message } = handleOrderTool(name, args, order);
      return {
        result: message,
        order: updatedOrder,
        memoryUpdate: { cartItemIds: updatedOrder.items.map(i => i.menuItemId) },
      };
    }

    case "confirm_order": {
      const { order: updatedOrder, message } = handleOrderTool(name, args, order);
      return {
        result: message,
        order: updatedOrder,
        memoryUpdate: {
          lastAction: "Order confirmed ✨",
          cartItemIds: [],
        },
      };
    }

    case "cancel_order": {
      const { order: updatedOrder, message } = handleOrderTool(name, args, order);
      return {
        result: message,
        order: updatedOrder,
        memoryUpdate: {
          lastAction: "Order cancelled",
          cartItemIds: [],
        },
      };
    }

    default:
      return { result: `Unknown tool: ${name}`, order, memoryUpdate: emptyMemory };
  }
}

// ============================================================================
// Conversation Loop
// ============================================================================

export interface ChatResult {
  reply: string;
  history: MessageParam[];
  order: Order;
  memory: ConversationMemory;
}

/**
 * Process a user message through the AI agent.
 *
 * @param userMessage - The customer's message
 * @param history - Previous conversation messages (mutated in place and returned)
 * @param order - The current order state
 * @param memory - The current conversation memory
 * @returns The AI's reply, updated history, updated order, and updated memory
 */
export async function chat(
  userMessage: string,
  history: MessageParam[] = [],
  order: Order = createOrder(),
  memory: ConversationMemory = createMemory()
): Promise<ChatResult> {
  const anthropic = getClient();

  // Append user message
  history.push({ role: "user", content: userMessage });

  let currentOrder = order;
  let currentMemory = { ...memory };

  // Tool-call loop
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // Build fresh system prompt each round with current memory + order
    const systemPrompt = buildSystemPrompt(currentOrder, currentMemory);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: history,
      tools: getAllTools(),
    });

    // Collect all content blocks
    const textBlocks: string[] = [];
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        textBlocks.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    // If no tool calls, return the text response
    if (toolCalls.length === 0) {
      const reply = textBlocks.join("\n");
      history.push({ role: "assistant", content: reply });
      return {
        reply,
        history: trimHistory(history),
        order: currentOrder,
        memory: currentMemory,
      };
    }

    // Build assistant content block with text + tool_use blocks
    const assistantContent: Anthropic.Messages.ContentBlock[] = [];
    for (const block of response.content) {
      assistantContent.push(block);
    }
    history.push({ role: "assistant", content: assistantContent });

    // Execute tool calls and build results
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tc of toolCalls) {
      const { result, order: updatedOrder, memoryUpdate } = dispatchTool(tc.name, tc.input, currentOrder);
      currentOrder = updatedOrder;

      // Merge memory updates
      for (const [key, value] of Object.entries(memoryUpdate)) {
        if (value !== undefined) {
          (currentMemory as Record<string, unknown>)[key] = value;
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: result,
      });
    }

    history.push({ role: "user", content: toolResults });
  }

  // Max rounds exceeded — return what we have
  const shortSummary = getOrderShortSummary(currentOrder);
  const fallback = `I've processed your request. Your current order: ${shortSummary}. Is there anything else?`;

  history.push({ role: "assistant", content: fallback });
  return {
    reply: fallback,
    history: trimHistory(history),
    order: currentOrder,
    memory: currentMemory,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function trimHistory(history: MessageParam[], maxMessages = 30): MessageParam[] {
  if (history.length <= maxMessages) return history;
  // Keep system context: trim middle messages, keeping first 2 and last (maxMessages - 2)
  const keep = maxMessages - 2;
  return [...history.slice(0, 2), ...history.slice(-keep)];
}

/**
 * Create a fresh conversation with a new order and empty memory.
 */
export function newConversation(): { history: MessageParam[]; order: Order; memory: ConversationMemory } {
  return {
    history: [],
    order: createOrder(),
    memory: createMemory(),
  };
}
