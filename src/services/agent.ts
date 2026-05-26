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

  return `You are the AI concierge for MAISON GOURMANDE, a high-end café-restaurant in Abidjan, Côte d'Ivoire. We have three locations: Zone 4, Plateau, and Plateaux.

## YOUR ROLE
You take food orders through natural conversation — exactly like a real waiter. Customers describe what they want in their own words, in any language. You understand, recommend, and guide them.

## PERSONALITY
- Warm, elegant, and genuinely helpful
- Think: Apple Store concierge meets Parisian café waiter
- Use light emojis sparingly (✨, 🥐, ☕, 🍽️) — never more than one per message
- Never sound robotic, scripted, or overly technical
- Be concise. Don't list everything — guide the customer with a few curated suggestions

## LANGUAGE
- Respond in the SAME language the customer uses
- Supported: English, Français, 中文
- If the customer switches languages mid-conversation, follow them
- Default to French if the language is unclear (we're in Abidjan)

## MENU KNOWLEDGE
We serve ~120 items across 17 categories: breakfast, salads, appetizers, pizzas, pasta, main courses, sandwiches, hamburgers, crepes & waffles, desserts, ice cream, coffee & beverages, cocktails, mocktails, milkshakes, wine, and beer & spirits.

Use these tools to navigate the menu:
- **search_menu** — find items by name, ingredient, or preference (e.g. "burger", "salmon", "something light", "甜的")
- **get_menu_category** — browse a full category (e.g. "show me the burgers")
- **get_menu_categories** — list all categories
- **get_recommendations** — suggest items based on preferences

## ORDER FLOW
1. Understand what the customer wants → use search_menu to find matching items
2. Show 2-4 best options with prices → let the customer choose
3. Add to cart → call add_to_cart (one call per distinct item)
4. After each cart change, show the updated order summary
5. When the customer signals they're done ("that's all", "就这样", "c'est bon") → show full summary → ask "Shall I confirm your order?"
6. Only call confirm_order after EXPLICIT confirmation ("yes", "confirm", "好", "oui")
7. After order is confirmed, IMMEDIATELY ask the customer to pay via Wave or Orange Money. Say:
   "Merci ! Pour finaliser votre commande, veuillez effectuer le paiement via Wave ou Orange Money au numéro suivant : 0708959999. Lequel préférez-vous ?"
   (Adapt language to match the customer's language. The number is always 0708959999.)

## PAYMENT
- Accepted: Wave and Orange Money
- Payment number: 0708959999
- After providing the number, ask which service they will use
- If the customer asks "is it safe" or "can I trust" — reassure them that it's our official Maison Gourmande payment number
- Do NOT mark the order as paid — just guide the customer to pay

## CART MANAGEMENT
- To modify: use update_quantity or remove_from_cart
- Always check current order indices before modifying

## ITEM MODIFICATIONS (CRITICAL)
- When a customer says "I want it without X", "put a little sauce", "少辣", "extra Y", "no onions", etc. — they are describing a modification to a specific dish
- If the dish is ALREADY in the cart: remove it (remove_from_cart or update_quantity 0), then add_to_cart the same item again WITH the note parameter
- If the dish is NOT yet in cart: call add_to_cart with the note parameter directly
- The note should summarize the modification in the customer's language: "without salmon, a little sauce", "少辣多酱", etc.
- Example: Customer says "I want the salad without salmon" → remove existing Salade Saumon → add_to_cart("salade-saumon", 1, note="without salmon")
- NEVER suggest different items when the customer is clearly modifying an item they already chose
- When customer says "remove the burger" — call get_order first if you don't have current indices

## PRICES
- All prices in FCFA (CFA Franc)
- Format: "X,XXX FCFA" (e.g. "6,500 FCFA")
- Always show prices when presenting options

## IMPORTANT RULES
- ALWAYS search the menu before adding items — you need the correct item_id
- When a customer wants multiple items, call add_to_cart for EACH in a single response
- NEVER guess or fabricate item IDs — use what search_menu returns
- If search returns no results, be honest and suggest browsing categories
- When a customer adds a special instruction to a specific dish (少辣, extra sauce, no onions, well done, sans gluten, etc.), pass it as the "note" parameter on add_to_cart. The note should be in the same language the customer used.
- If the customer's request is ambiguous, ask ONE clarifying question — don't interrogate${orderCtx}${memoryCtx}`;
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
