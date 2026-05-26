import { describe, it, expect } from "vitest";
import { newConversation } from "../src/services/agent.js";
import { createOrder, addToCart, getOrderSummary } from "../src/services/order-engine.js";
import {
  search,
  getByCategory,
  getById,
  getRecommendations,
  getCategories,
} from "../src/services/menu-search.js";
import { handleOrderTool } from "../src/services/order-tools.js";
import { OrderStatus, OrderError } from "../src/types/order.js";
import type { Order } from "../src/types/order.js";

// ============================================================================
// Tool Dispatch Tests (test the underlying logic without Claude API)
// ============================================================================

describe("Menu Tool Dispatch", () => {
  it("search_menu returns matching items with IDs", () => {
    const results = search("burger");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.item.id).toBeTruthy();
      expect(r.item.name).toBeTruthy();
      expect(typeof r.item.price).toBe("number");
    }
  });

  it("get_menu_category returns all items in a category", () => {
    const items = getByCategory("hamburgers" as any);
    expect(items.length).toBe(5);
    expect(items.every(i => i.category === "hamburgers")).toBe(true);
  });

  it("get_menu_item returns item details", () => {
    const item = getById("smash-burger");
    expect(item).toBeDefined();
    expect(item!.name).toBe("SMASH BURGER");
    expect(item!.price).toBe(6500);
    expect(item!.nameZh).toBeTruthy();
  });

  it("get_menu_item returns undefined for unknown ID", () => {
    expect(getById("nonexistent")).toBeUndefined();
  });

  it("get_menu_categories returns all categories", () => {
    const cats = getCategories();
    expect(cats.length).toBeGreaterThan(10);
    for (const cat of cats) {
      expect(cat.id).toBeTruthy();
      expect(cat.labels.fr).toBeTruthy();
      expect(cat.itemCount).toBeGreaterThan(0);
    }
  });

  it("get_recommendations returns items filtered by preferences", () => {
    const items = getRecommendations(["light", "healthy"]);
    expect(items.length).toBeGreaterThan(0);
    // All items should be healthy/light related
    const allTags = items.flatMap(i => i.tags);
    const hasRelevant = allTags.some(t => t === "light" || t === "healthy" || t === "fresh");
    expect(hasRelevant).toBe(true);
  });
});

describe("Order Tool Dispatch", () => {
  it("add_to_cart adds item and returns updated order", () => {
    const order = createOrder();
    const result = handleOrderTool("add_to_cart", { item_id: "smash-burger", quantity: 2 }, order);
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0]!.quantity).toBe(2);
    expect(result.order.total).toBe(13000);
    // Original order unchanged (immutability)
    expect(order.items).toHaveLength(0);
  });

  it("get_order returns summary with items", () => {
    const order = createOrder();
    const r1 = handleOrderTool("add_to_cart", { item_id: "quinoa-power", quantity: 1 }, order);
    const result = handleOrderTool("get_order", {}, r1.order);
    expect(result.message).toContain("QUINOA POWER");
    expect(result.message).toContain("8,000");
  });

  it("confirm_order locks the order", () => {
    const order = createOrder();
    const r1 = handleOrderTool("add_to_cart", { item_id: "smash-burger", quantity: 1 }, order);
    const r2 = handleOrderTool("confirm_order", {}, r1.order);
    expect(r2.order.status).toBe(OrderStatus.CONFIRMED);
    // Trying to add after confirm should error
    const r3 = handleOrderTool("add_to_cart", { item_id: "coca-cola" }, r2.order);
    expect(r3.message).toContain("Error");
  });

  it("cancel_order cancels the order", () => {
    const order = createOrder();
    const r1 = handleOrderTool("add_to_cart", { item_id: "smash-burger" }, order);
    const r2 = handleOrderTool("cancel_order", {}, r1.order);
    expect(r2.order.status).toBe(OrderStatus.CANCELLED);
  });

  it("remove_from_cart removes an item", () => {
    const order = createOrder();
    const r1 = handleOrderTool("add_to_cart", { item_id: "smash-burger" }, order);
    const r2 = handleOrderTool("add_to_cart", { item_id: "coca-cola" }, r1.order);
    expect(r2.order.items).toHaveLength(2);

    const r3 = handleOrderTool("remove_from_cart", { index: 0 }, r2.order);
    expect(r3.order.items).toHaveLength(1);
    expect(r3.order.items[0]!.menuItemId).toBe("coca-cola");
  });

  it("update_quantity changes item quantity", () => {
    const order = createOrder();
    const r1 = handleOrderTool("add_to_cart", { item_id: "smash-burger" }, order);
    const r2 = handleOrderTool("update_quantity", { index: 0, quantity: 3 }, r1.order);
    expect(r2.order.items[0]!.quantity).toBe(3);
  });

  it("errors with helpful message for unknown item", () => {
    const order = createOrder();
    const result = handleOrderTool("add_to_cart", { item_id: "fake-item" }, order);
    expect(result.message).toContain("not found");
    expect(result.order.items).toHaveLength(0);
  });
});

describe("newConversation()", () => {
  it("creates fresh history and empty order", () => {
    const { history, order } = newConversation();
    expect(history).toEqual([]);
    expect(order.items).toHaveLength(0);
    expect(order.status).toBe(OrderStatus.DRAFT);
    expect(order.total).toBe(0);
  });
});

describe("End-to-end order flow (without AI)", () => {
  it("completes a full ordering scenario: add → modify → remove → confirm", () => {
    let order = createOrder();

    // Add two items
    const r1 = handleOrderTool("add_to_cart", { item_id: "smash-burger", quantity: 2 }, order);
    order = r1.order;
    expect(order.items).toHaveLength(1);
    expect(order.total).toBe(13000);

    const r2 = handleOrderTool("add_to_cart", { item_id: "coca-cola", quantity: 1 }, order);
    order = r2.order;
    expect(order.items).toHaveLength(2);
    expect(order.total).toBe(15000); // 13000 + 2000

    // Update quantity
    const r3 = handleOrderTool("update_quantity", { index: 1, quantity: 2 }, order);
    order = r3.order;
    expect(order.items[1]!.quantity).toBe(2);
    expect(order.total).toBe(17000); // 13000 + 4000

    // Remove first item
    const r4 = handleOrderTool("remove_from_cart", { index: 0 }, order);
    order = r4.order;
    expect(order.items).toHaveLength(1);
    expect(order.total).toBe(4000);

    // Confirm
    const r5 = handleOrderTool("confirm_order", {}, order);
    order = r5.order;
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(r5.message).toContain("Order confirmed");
  });
});
