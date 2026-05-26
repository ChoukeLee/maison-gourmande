/**
 * Conversation Memory — structured ephemeral state that helps the AI
 * resolve anaphoric references like "再来一个", "第一个", "那就这个吧".
 *
 * This is NOT persisted across sessions. It's in-memory per conversation.
 */

/** What kind of view was most recently shown to the customer */
export type ShownType = "search" | "category" | "recommendations";

/** Structured conversation memory */
export interface ConversationMemory {
  /** Human-readable summary of the last thing that happened */
  lastAction: string | null;
  /** Item IDs from the most recent search / category / recommendations call */
  lastShownItemIds: string[];
  /** Names matching lastShownItemIds (for display in memory context) */
  lastShownItemNames: string[];
  /** What kind of view was last shown */
  lastShownType: ShownType | null;
  /** The query or category that produced the last shown items */
  lastShownQuery: string | null;
  /** Item ID most recently added to cart */
  lastAddedItemId: string | null;
  /** Item name most recently added to cart */
  lastAddedItemName: string | null;
  /** Item name most recently removed from cart */
  lastRemovedItemName: string | null;
  /** IDs of items currently in the cart */
  cartItemIds: string[];
}

/** Create a fresh empty memory */
export function createMemory(): ConversationMemory {
  return {
    lastAction: null,
    lastShownItemIds: [],
    lastShownItemNames: [],
    lastShownType: null,
    lastShownQuery: null,
    lastAddedItemId: null,
    lastAddedItemName: null,
    lastRemovedItemName: null,
    cartItemIds: [],
  };
}

/**
 * Build the memory context section to inject into the system prompt.
 * Returns empty string if memory has no useful data.
 */
export function formatMemoryContext(memory: ConversationMemory): string {
  const parts: string[] = [];

  if (memory.lastAction) {
    parts.push(`Last action: ${memory.lastAction}`);
  }

  if (memory.lastShownItemIds.length > 0) {
    const items = memory.lastShownItemIds.map((id, i) => {
      const name = memory.lastShownItemNames[i] ?? id;
      return `[${i}] ${name} (id: ${id})`;
    }).join(", ");
    const typeLabel = memory.lastShownType === "search" ? "Search" :
      memory.lastShownType === "category" ? "Category" : "Recommendations";
    parts.push(`Last shown (${typeLabel}${memory.lastShownQuery ? ` for "${memory.lastShownQuery}"` : ""}): ${items}`);
  }

  if (memory.lastAddedItemId) {
    parts.push(`Last added: ${memory.lastAddedItemName ?? memory.lastAddedItemId} (id: ${memory.lastAddedItemId})`);
  }

  if (memory.lastRemovedItemName) {
    parts.push(`Last removed: ${memory.lastRemovedItemName}`);
  }

  if (memory.cartItemIds.length > 0) {
    parts.push(`Cart item IDs: [${memory.cartItemIds.join(", ")}]`);
  }

  if (parts.length === 0) return "";

  return `\n\n[CONVERSATION MEMORY]\n${parts.join("\n")}\n\nUse this memory to resolve references:\n- "再来一个" / "one more" / "encore un" → add lastAddedItemId again\n- "那就这个吧" / "I'll take that" / "就要这个" → add lastShownItemIds[0]\n- "第一个" / "the first one" → lastShownItemIds[0]\n- "第二个" / "the second one" → lastShownItemIds[1]\n- "不要了" / "remove it" / "取消" → remove the last added item from cart`;
}
