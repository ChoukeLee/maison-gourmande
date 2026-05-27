import { getById, isSoldOut } from "./menu-search.js";
import type { MenuItem } from "../types/menu.js";
import {
  OrderStatus,
  STATUS_TRANSITIONS,
  STATUS_LABELS,
  OrderSource,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PosStatus,
  OrderError,
  type CartItem,
  type Order,
  type OrderOperationResult,
} from "../types/order.js";

// ============================================================================
// Helpers
// ============================================================================

let orderCounter = 0;

function generateId(): string {
  orderCounter++;
  const ts = Date.now().toString(36).slice(-6);
  const seq = orderCounter.toString(36).padStart(4, "0");
  return `MG-${ts}-${seq}`.toUpperCase();
}

function now(): number {
  return Date.now();
}

function computeTotal(items: CartItem[]): { total: number; itemCount: number } {
  let total = 0;
  let itemCount = 0;
  for (const item of items) {
    total += item.unitPrice * item.quantity;
    itemCount += item.quantity;
  }
  return { total, itemCount };
}

/**
 * Find index of an item in the cart matching both menuItemId and selectedOption.
 * Returns -1 if not found.
 */
function findItemIndex(items: CartItem[], menuItemId: string, option?: string): number {
  return items.findIndex(
    item =>
      item.menuItemId === menuItemId &&
      (item.selectedOption ?? "") === (option ?? "")
  );
}

function cloneOrder(order: Order): Order {
  return {
    ...order,
    items: order.items.map(item => ({ ...item })),
  };
}

// ============================================================================
// Order Operations
// ============================================================================

/**
 * Create a new empty draft order.
 */
export function createOrder(): Order {
  return {
    id: generateId(),
    storeId: "maison-gourmande",
    source: OrderSource.WEB,
    orderType: OrderType.DINE_IN,
    items: [],
    status: OrderStatus.DRAFT,
    paymentStatus: PaymentStatus.UNPAID,
    paymentMethod: PaymentMethod.UNKNOWN,
    posStatus: PosStatus.NOT_ENTERED,
    total: 0,
    itemCount: 0,
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * Add an item to the cart. If the same item (same menuItemId + same option)
 * already exists, increments its quantity instead of duplicating.
 *
 * @throws {OrderError} if the item is not found or has an unconfirmed price
 * @throws {OrderError} if the order is not in DRAFT status
 */
export function addToCart(
  order: Order,
  menuItemId: string,
  quantity = 1,
  selectedOption?: string,
  note?: string
): OrderOperationResult {
  if (order.status !== OrderStatus.DRAFT) {
    throw new OrderOperationError(OrderError.ORDER_NOT_DRAFT, order);
  }
  if (quantity < 1) {
    throw new OrderOperationError(OrderError.INVALID_INDEX, order, "Quantity must be at least 1");
  }

  const menuItem = getById(menuItemId);
  if (!menuItem) {
    throw new OrderOperationError(OrderError.ITEM_NOT_FOUND, order, `Item "${menuItemId}" not found`);
  }
  if (isSoldOut(menuItemId)) {
    throw new OrderOperationError(OrderError.ITEM_UNAVAILABLE, order, `"${menuItem.name}" is sold out today`);
  }
  if (menuItem.price === null) {
    throw new OrderOperationError(OrderError.PRICE_NOT_CONFIRMED, order, `Price for "${menuItem.name}" is not yet confirmed`);
  }

  const updated = cloneOrder(order);
  const existingIdx = findItemIndex(updated.items, menuItemId, selectedOption);

  let message: string;

  if (existingIdx >= 0) {
    // Increment existing item
    const item = updated.items[existingIdx]!;
    item.quantity += quantity;
    if (note) item.note = note;
    message = `Increased ${item.name}${selectedOption ? ` (${selectedOption})` : ""} to x${item.quantity}${note ? ` (note: ${note})` : ""}`;
  } else {
    // Add new line item
    updated.items.push({
      menuItemId: menuItem.id,
      name: menuItem.name,
      nameZh: menuItem.nameZh,
      quantity,
      unitPrice: menuItem.price,
      selectedOption,
      note,
      addedAt: now(),
    });
    const displayName = menuItem.nameZh ? `${menuItem.name} (${menuItem.nameZh})` : menuItem.name;
    message = `Added ${displayName}${selectedOption ? ` (${selectedOption})` : ""} x${quantity}${note ? ` (note: ${note})` : ""}`;
  }

  const totals = computeTotal(updated.items);
  updated.total = totals.total;
  updated.itemCount = totals.itemCount;
  updated.updatedAt = now();

  return { order: updated, message };
}

/**
 * Remove an item from the cart by its index.
 *
 * @throws {OrderError} if index is invalid or order is not DRAFT
 */
export function removeFromCart(order: Order, index: number): OrderOperationResult {
  if (order.status !== OrderStatus.DRAFT) {
    throw new OrderOperationError(OrderError.ORDER_NOT_DRAFT, order);
  }

  const updated = cloneOrder(order);
  if (index < 0 || index >= updated.items.length) {
    throw new OrderOperationError(OrderError.INVALID_INDEX, order, `Index ${index} is out of range (0-${updated.items.length - 1})`);
  }

  const removed = updated.items[index]!;
  updated.items.splice(index, 1);

  const totals = computeTotal(updated.items);
  updated.total = totals.total;
  updated.itemCount = totals.itemCount;
  updated.updatedAt = now();

  const displayName = removed.nameZh ? `${removed.name} (${removed.nameZh})` : removed.name;
  return {
    order: updated,
    message: `Removed ${displayName}${removed.selectedOption ? ` (${removed.selectedOption})` : ""} from the order`,
  };
}

/**
 * Update the quantity of an item in the cart. Setting quantity to 0 removes the item.
 *
 * @throws {OrderError} if index is invalid, quantity is negative, or order is not DRAFT
 */
export function updateQuantity(order: Order, index: number, quantity: number): OrderOperationResult {
  if (order.status !== OrderStatus.DRAFT) {
    throw new OrderOperationError(OrderError.ORDER_NOT_DRAFT, order);
  }

  const updated = cloneOrder(order);
  if (index < 0 || index >= updated.items.length) {
    throw new OrderOperationError(OrderError.INVALID_INDEX, order, `Index ${index} is out of range (0-${updated.items.length - 1})`);
  }
  if (quantity < 0) {
    throw new OrderOperationError(OrderError.INVALID_INDEX, order, "Quantity cannot be negative");
  }

  const item = updated.items[index]!;

  if (quantity === 0) {
    // Remove the item entirely
    updated.items.splice(index, 1);
    const displayName = item.nameZh ? `${item.name} (${item.nameZh})` : item.name;
    const totals = computeTotal(updated.items);
    updated.total = totals.total;
    updated.itemCount = totals.itemCount;
    updated.updatedAt = now();
    return {
      order: updated,
      message: `Removed ${displayName} from the order`,
    };
  }

  const oldQty = item.quantity;
  item.quantity = quantity;

  const totals = computeTotal(updated.items);
  updated.total = totals.total;
  updated.itemCount = totals.itemCount;
  updated.updatedAt = now();

  const displayName = item.nameZh ? `${item.name} (${item.nameZh})` : item.name;
  return {
    order: updated,
    message: `Changed ${displayName} from x${oldQty} to x${quantity}`,
  };
}

/**
 * Empty the entire cart.
 *
 * @throws {OrderError} if order is not DRAFT
 */
export function clearCart(order: Order): OrderOperationResult {
  if (order.status !== OrderStatus.DRAFT) {
    throw new OrderOperationError(OrderError.ORDER_NOT_DRAFT, order);
  }

  const updated = cloneOrder(order);
  updated.items = [];
  updated.total = 0;
  updated.itemCount = 0;
  updated.updatedAt = now();

  return { order: updated, message: "Cart has been cleared" };
}

/**
 * Confirm the order — moves from DRAFT to CONFIRMED.
 *
 * @throws {OrderError} if cart is empty or status is not DRAFT
 */
export function confirmOrder(order: Order, note?: string): OrderOperationResult {
  if (order.status !== OrderStatus.DRAFT) {
    throw new OrderOperationError(OrderError.ORDER_ALREADY_CONFIRMED, order);
  }
  if (order.items.length === 0) {
    throw new OrderOperationError(OrderError.EMPTY_CART, order, "Cannot confirm an empty order");
  }

  const updated = cloneOrder(order);
  updated.status = OrderStatus.CONFIRMED;
  updated.updatedAt = now();
  if (note) {
    updated.note = note;
  }

  const itemList = formatItemList(updated.items);
  return {
    order: updated,
    message: `Order confirmed! ✨\n\n${itemList}\n\nTotal: ${updated.total.toLocaleString()} FCFA\nOrder #${updated.id}`,
  };
}

/**
 * Cancel the current order.
 */
export function cancelOrder(order: Order): OrderOperationResult {
  const updated = cloneOrder(order);
  updated.status = OrderStatus.CANCELLED;
  updated.updatedAt = now();

  return { order: updated, message: "Order has been cancelled" };
}

/**
 * Advance the order to the next status in the lifecycle.
 * DRAFT → CONFIRMED → PREPARING → READY → COMPLETED
 *
 * @throws {OrderError} if the status transition is invalid
 */
export function advanceStatus(order: Order): OrderOperationResult {
  const allowed = STATUS_TRANSITIONS[order.status];
  if (!allowed || allowed.length === 0) {
    throw new OrderOperationError(OrderError.INVALID_STATUS, order, `Cannot advance from status "${order.status}"`);
  }

  // Pick the first non-cancel transition
  const nextStatus = allowed[0]!;
  const updated = cloneOrder(order);
  updated.status = nextStatus;
  updated.updatedAt = now();

  const labels = STATUS_LABELS[nextStatus];
  return {
    order: updated,
    message: `Order status changed to: ${labels.en}`,
  };
}

// ============================================================================
// Query Operations
// ============================================================================

function formatItemList(items: CartItem[]): string {
  return items
    .map((item, i) => {
      const line = `${i + 1}. ${item.name}${item.selectedOption ? ` (${item.selectedOption})` : ""} x${item.quantity}`;
      const subtotal = item.unitPrice * item.quantity;
      return `${line} — ${subtotal.toLocaleString()} FCFA`;
    })
    .join("\n");
}

/**
 * Get a human-readable summary of the current order.
 * Suitable for displaying to the customer via the AI.
 */
export function getOrderSummary(order: Order): string {
  if (order.items.length === 0) {
    return "Your order is currently empty.";
  }

  const itemList = formatItemList(order.items);
  const statusLabel = STATUS_LABELS[order.status].en;

  let summary = `Order #${order.id}\nStatus: ${statusLabel}\n\n${itemList}\n\nTotal: ${order.total.toLocaleString()} FCFA`;
  if (order.note) {
    summary += `\nNote: ${order.note}`;
  }
  return summary;
}

/**
 * Get a concise inline summary — for the AI to reference mid-conversation.
 */
export function getOrderShortSummary(order: Order): string {
  if (order.items.length === 0) return "Empty order";

  const lines = order.items.map(
    item => `${item.name}${item.selectedOption ? ` (${item.selectedOption})` : ""} x${item.quantity}`
  );
  return `${lines.join(", ")} | Total: ${order.total.toLocaleString()} FCFA`;
}

/**
 * Check if the order can be modified (i.e., is in DRAFT status).
 */
export function isModifiable(order: Order): boolean {
  return order.status === OrderStatus.DRAFT;
}

// ============================================================================
// Error class
// ============================================================================

export class OrderOperationError extends Error {
  public readonly code: OrderError;
  public readonly order: Order;

  constructor(code: OrderError, order: Order, message?: string) {
    super(message ?? code);
    this.name = "OrderOperationError";
    this.code = code;
    this.order = order;
  }
}
