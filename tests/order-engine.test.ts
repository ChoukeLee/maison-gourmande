import { describe, it, expect } from "vitest";
import {
  createOrder,
  addToCart,
  removeFromCart,
  updateQuantity,
  clearCart,
  confirmOrder,
  cancelOrder,
  advanceStatus,
  getOrderSummary,
  getOrderShortSummary,
  isModifiable,
  OrderOperationError,
} from "../src/services/order-engine.js";
import { OrderStatus, OrderError } from "../src/types/order.js";

describe("Order Engine", () => {
  describe("createOrder()", () => {
    it("creates a new empty draft order", () => {
      const order = createOrder();
      expect(order.status).toBe(OrderStatus.DRAFT);
      expect(order.items).toHaveLength(0);
      expect(order.total).toBe(0);
      expect(order.itemCount).toBe(0);
      expect(order.id).toMatch(/^MG-/);
    });

    it("generates unique IDs", () => {
      const o1 = createOrder();
      const o2 = createOrder();
      expect(o1.id).not.toBe(o2.id);
    });
  });

  describe("addToCart()", () => {
    it("adds an item to the cart", () => {
      const order = createOrder();
      const result = addToCart(order, "smash-burger", 2);
      expect(result.order.items).toHaveLength(1);
      expect(result.order.items[0]!.menuItemId).toBe("smash-burger");
      expect(result.order.items[0]!.quantity).toBe(2);
      expect(result.order.items[0]!.unitPrice).toBe(6500);
      expect(result.order.total).toBe(13000);
      expect(result.order.itemCount).toBe(2);
    });

    it("increments quantity when adding the same item again", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = addToCart(r1.order, "smash-burger", 2);
      expect(r2.order.items).toHaveLength(1);
      expect(r2.order.items[0]!.quantity).toBe(3);
      expect(r2.order.total).toBe(19500);
    });

    it("creates separate line items for same item with different options", () => {
      const order = createOrder();
      const r1 = addToCart(order, "pates-saumon", 1, "Spaghetti");
      const r2 = addToCart(r1.order, "pates-saumon", 1, "Tagliatelle");
      expect(r2.order.items).toHaveLength(2);
      expect(r2.order.items[0]!.selectedOption).toBe("Spaghetti");
      expect(r2.order.items[1]!.selectedOption).toBe("Tagliatelle");
    });

    it("throws when adding an item with unconfirmed price", () => {
      const order = createOrder();
      expect(() => addToCart(order, "bagel-saumon", 1)).toThrow(OrderOperationError);
    });

    it("throws when adding an unknown item", () => {
      const order = createOrder();
      expect(() => addToCart(order, "not-a-real-item", 1)).toThrow(OrderOperationError);
    });

    it("throws when modifying a non-draft order", () => {
      const order = createOrder();
      const confirmed = confirmOrder(addToCart(order, "smash-burger", 1).order);
      expect(() => addToCart(confirmed.order, "cheese-burger", 1)).toThrow(OrderOperationError);
    });

    it("computes total correctly with multiple items", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);    // 6500
      const r2 = addToCart(r1.order, "coca-cola", 2);     // 2000 * 2 = 4000
      expect(r2.order.total).toBe(10500);
      expect(r2.order.itemCount).toBe(3);
    });

    it("generates a human-readable message", () => {
      const order = createOrder();
      const result = addToCart(order, "quinoa-power", 1);
      expect(result.message).toContain("QUINOA POWER");
    });
  });

  describe("removeFromCart()", () => {
    it("removes an item by index", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = addToCart(r1.order, "coca-cola", 1);
      expect(r2.order.items).toHaveLength(2);

      const r3 = removeFromCart(r2.order, 0);
      expect(r3.order.items).toHaveLength(1);
      expect(r3.order.items[0]!.menuItemId).toBe("coca-cola");
      expect(r3.order.total).toBe(2000);
    });

    it("throws with invalid index", () => {
      const order = createOrder();
      expect(() => removeFromCart(order, 0)).toThrow(OrderOperationError);
      expect(() => removeFromCart(order, -1)).toThrow(OrderOperationError);
    });
  });

  describe("updateQuantity()", () => {
    it("changes item quantity", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      expect(r1.order.total).toBe(6500);

      const r2 = updateQuantity(r1.order, 0, 3);
      expect(r2.order.items[0]!.quantity).toBe(3);
      expect(r2.order.total).toBe(19500);
    });

    it("removes item when quantity is 0", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = addToCart(r1.order, "coca-cola", 1);
      const r3 = updateQuantity(r2.order, 0, 0);
      expect(r3.order.items).toHaveLength(1);
      expect(r3.order.items[0]!.menuItemId).toBe("coca-cola");
    });

    it("throws with negative quantity", () => {
      const order = addToCart(createOrder(), "smash-burger", 1).order;
      expect(() => updateQuantity(order, 0, -1)).toThrow(OrderOperationError);
    });
  });

  describe("clearCart()", () => {
    it("removes all items", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 2);
      const r2 = addToCart(r1.order, "coca-cola", 1);
      const r3 = clearCart(r2.order);
      expect(r3.order.items).toHaveLength(0);
      expect(r3.order.total).toBe(0);
      expect(r3.order.itemCount).toBe(0);
    });
  });

  describe("confirmOrder()", () => {
    it("confirms a non-empty draft order", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order);
      expect(r2.order.status).toBe(OrderStatus.CONFIRMED);
      expect(r2.message).toContain("Order confirmed");
    });

    it("throws when confirming an empty order", () => {
      const order = createOrder();
      expect(() => confirmOrder(order)).toThrow(OrderOperationError);
    });

    it("throws when confirming an already confirmed order", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order);
      expect(() => confirmOrder(r2.order)).toThrow(OrderOperationError);
    });

    it("attaches an optional note", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order, "No onions please");
      expect(r2.order.note).toBe("No onions please");
    });

    it("locks the order from further modifications", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order);
      expect(isModifiable(r2.order)).toBe(false);
      expect(() => addToCart(r2.order, "coca-cola", 1)).toThrow(OrderOperationError);
      expect(() => removeFromCart(r2.order, 0)).toThrow(OrderOperationError);
      expect(() => updateQuantity(r2.order, 0, 2)).toThrow(OrderOperationError);
    });
  });

  describe("cancelOrder()", () => {
    it("cancels the order", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = cancelOrder(r1.order);
      expect(r2.order.status).toBe(OrderStatus.CANCELLED);
    });
  });

  describe("advanceStatus()", () => {
    it("advances CONFIRMED → PREPARING → READY → COMPLETED", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order);

      const r3 = advanceStatus(r2.order);
      expect(r3.order.status).toBe(OrderStatus.PREPARING);

      const r4 = advanceStatus(r3.order);
      expect(r4.order.status).toBe(OrderStatus.READY);

      const r5 = advanceStatus(r4.order);
      expect(r5.order.status).toBe(OrderStatus.COMPLETED);
    });

    it("throws when advancing a completed order", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order);
      const r3 = advanceStatus(r2.order);
      const r4 = advanceStatus(r3.order);
      const r5 = advanceStatus(r4.order);
      expect(() => advanceStatus(r5.order)).toThrow(OrderOperationError);
    });
  });

  describe("getOrderSummary()", () => {
    it("returns readable summary with items and total", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 2);
      const summary = getOrderSummary(r1.order);
      expect(summary).toContain("SMASH BURGER");
      expect(summary).toContain("x2");
      expect(summary).toContain("13,000");
    });

    it("returns empty message when order has no items", () => {
      const order = createOrder();
      const summary = getOrderSummary(order);
      expect(summary).toContain("empty");
    });
  });

  describe("getOrderShortSummary()", () => {
    it("returns concise one-line summary", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = addToCart(r1.order, "coca-cola", 2);
      const summary = getOrderShortSummary(r2.order);
      expect(summary).toContain("SMASH BURGER");
      expect(summary).toContain("COCA COLA");
      expect(summary).toContain("10,500");
    });
  });

  describe("isModifiable()", () => {
    it("returns true for draft orders", () => {
      const order = createOrder();
      expect(isModifiable(order)).toBe(true);
    });

    it("returns false after confirmation", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      const r2 = confirmOrder(r1.order);
      expect(isModifiable(r2.order)).toBe(false);
    });
  });

  describe("immutability", () => {
    it("does not mutate the original order", () => {
      const order = createOrder();
      const r1 = addToCart(order, "smash-burger", 1);
      // Original order should still be empty
      expect(order.items).toHaveLength(0);
      expect(order.total).toBe(0);
      // New order has the changes
      expect(r1.order.items).toHaveLength(1);
    });
  });
});
