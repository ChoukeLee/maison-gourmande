import { describe, it, expect } from "vitest";
import { createMemory, formatMemoryContext } from "../src/types/memory.js";
import { newConversation } from "../src/services/agent.js";
import { createOrder } from "../src/services/order-engine.js";
import { getById } from "../src/services/menu-search.js";

describe("ConversationMemory", () => {
  describe("createMemory()", () => {
    it("creates empty memory", () => {
      const mem = createMemory();
      expect(mem.lastAction).toBeNull();
      expect(mem.lastShownItemIds).toEqual([]);
      expect(mem.lastAddedItemId).toBeNull();
      expect(mem.cartItemIds).toEqual([]);
    });
  });

  describe("formatMemoryContext()", () => {
    it("returns empty string for empty memory", () => {
      const mem = createMemory();
      expect(formatMemoryContext(mem)).toBe("");
    });

    it("formats last action", () => {
      const mem = createMemory();
      mem.lastAction = "Searched menu for 'burger' — found 5 items";
      const ctx = formatMemoryContext(mem);
      expect(ctx).toContain("Last action: Searched menu for 'burger'");
    });

    it("formats shown items with indices", () => {
      const mem = createMemory();
      mem.lastShownItemIds = ["smash-burger", "cheese-burger"];
      mem.lastShownItemNames = ["SMASH BURGER", "CHEESE BURGER"];
      mem.lastShownType = "search";
      mem.lastShownQuery = "burger";
      const ctx = formatMemoryContext(mem);
      expect(ctx).toContain("[0] SMASH BURGER (id: smash-burger)");
      expect(ctx).toContain("[1] CHEESE BURGER (id: cheese-burger)");
      expect(ctx).toContain("Search");
      expect(ctx).toContain("burger");
    });

    it("formats last added item", () => {
      const mem = createMemory();
      mem.lastAddedItemId = "smash-burger";
      mem.lastAddedItemName = "SMASH BURGER";
      const ctx = formatMemoryContext(mem);
      expect(ctx).toContain("Last added: SMASH BURGER (id: smash-burger)");
    });

    it("formats cart item IDs", () => {
      const mem = createMemory();
      mem.cartItemIds = ["smash-burger", "coca-cola"];
      const ctx = formatMemoryContext(mem);
      expect(ctx).toContain("Cart item IDs: [smash-burger, coca-cola]");
    });

    it("includes resolution hints", () => {
      const mem = createMemory();
      mem.lastAddedItemId = "smash-burger";
      mem.lastAddedItemName = "SMASH BURGER";
      const ctx = formatMemoryContext(mem);
      expect(ctx).toContain("再来一个");
      expect(ctx).toContain("one more");
      expect(ctx).toContain("lastAddedItemId again");
    });

    it("includes full memory context with all fields", () => {
      const mem = createMemory();
      mem.lastAction = "Added SMASH BURGER to cart";
      mem.lastShownItemIds = ["smash-burger", "cheese-burger"];
      mem.lastShownItemNames = ["SMASH BURGER", "CHEESE BURGER"];
      mem.lastShownType = "search";
      mem.lastShownQuery = "burger";
      mem.lastAddedItemId = "smash-burger";
      mem.lastAddedItemName = "SMASH BURGER";
      mem.cartItemIds = ["smash-burger"];

      const ctx = formatMemoryContext(mem);
      expect(ctx).toContain("[CONVERSATION MEMORY]");
      expect(ctx).toContain("Last action");
      expect(ctx).toContain("Last shown");
      expect(ctx).toContain("Last added");
      expect(ctx).toContain("Cart item IDs");
    });
  });

  describe("newConversation() includes memory", () => {
    it("returns fresh memory", () => {
      const { history, order, memory } = newConversation();
      expect(history).toEqual([]);
      expect(order.items).toHaveLength(0);
      expect(memory.lastAction).toBeNull();
      expect(memory.lastShownItemIds).toEqual([]);
    });
  });

  describe("memory references resolve to real items", () => {
    it("lastAddedItemId refers to a valid menu item", () => {
      const item = getById("smash-burger");
      expect(item).toBeDefined();
      expect(item!.price).toBe(6500);
    });

    it("lastShownItemIds refer to valid items", () => {
      const ids = ["smash-burger", "quinoa-power", "coca-cola"];
      for (const id of ids) {
        expect(getById(id)).toBeDefined();
      }
    });
  });
});
