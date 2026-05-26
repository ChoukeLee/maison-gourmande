/**
 * Claude API Tool Definitions for Order Operations.
 *
 * These tool schemas define the interface between the AI Agent and the
 * Order Engine. The AI calls these tools to manage the customer's cart.
 *
 * Key principle: AI understands intent and calls tools. Code executes.
 * The AI never directly mutates order state.
 */

import type { MenuTool } from "./menu-tools.js";
import type { Order } from "../types/order.js";
import {
  createOrder,
  addToCart,
  removeFromCart,
  updateQuantity,
  clearCart,
  confirmOrder,
  cancelOrder,
  getOrderSummary,
  getOrderShortSummary,
  OrderOperationError,
} from "./order-engine.js";

export const orderTools: MenuTool[] = [
  {
    name: "add_to_cart",
    description:
      "Add one or more items to the customer's order cart. " +
      "Use this when the customer explicitly says they want to order something. " +
      "If adding the same item with the same option again, the quantity will be increased. " +
      "Call this for EACH distinct item the customer wants — you can make multiple tool calls in one response.",
    input_schema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "The menu item ID to add (e.g. 'smash-burger', 'quinoa-power'). Get this from search_menu results.",
        },
        quantity: {
          type: "number",
          description: "Quantity to add (default 1)",
          default: 1,
          minimum: 1,
        },
        option: {
          type: "string",
          description: "Optional variant selection. E.g. for pasta: 'Spaghetti', 'Tagliatelle', 'Penne'. For wine: 'Rouge', 'Blanc', 'Rosé'. For milkshake: 'Vanille', 'Chocolat', etc.",
        },
        note: {
          type: "string",
          description: "Special instructions for this item only. E.g. '少辣', 'extra sauce', 'no onions', 'well done', 'sans gluten'. Use when the customer adds a condition to a specific dish.",
        },
      },
      required: ["item_id"],
    },
  },
  {
    name: "remove_from_cart",
    description:
      "Remove an item from the order cart by its index position. " +
      "Use when the customer says things like 'remove the burger', 'I don't want the coke anymore', '取消可乐'. " +
      "First check the current order with get_order to find the correct item index.",
    input_schema: {
      type: "object",
      properties: {
        index: {
          type: "number",
          description: "The 0-based index of the item in the cart (shown in the order summary). E.g. 0 for the first item, 1 for the second.",
          minimum: 0,
        },
      },
      required: ["index"],
    },
  },
  {
    name: "update_quantity",
    description:
      "Change the quantity of an item already in the cart. " +
      "Use when the customer says things like 'make that 2', 'just one burger', 'change the coke to 3'. " +
      "Setting quantity to 0 removes the item. First check the current order to find the correct index.",
    input_schema: {
      type: "object",
      properties: {
        index: {
          type: "number",
          description: "The 0-based index of the item in the cart to update.",
          minimum: 0,
        },
        quantity: {
          type: "number",
          description: "The new quantity. Set to 0 to remove the item.",
          minimum: 0,
        },
      },
      required: ["index", "quantity"],
    },
  },
  {
    name: "get_order",
    description:
      "Get the current state of the customer's order — all items, quantities, prices, and total. " +
      "Use this when the customer asks 'what did I order?', '我刚刚点了什么?', 'how much is my order?', " +
      "or before modifying the cart to check item indices.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "confirm_order",
    description:
      "Confirm and submit the order. After this, the order can no longer be modified. " +
      "Use ONLY when the customer explicitly confirms they want to place the order, " +
      "e.g. 'yes', 'confirm', 'that's all', '就这样', 'c'est bon'. " +
      "Always show the order summary and ask for confirmation before calling this.",
    input_schema: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "Optional special instructions or note from the customer",
        },
      },
    },
  },
  {
    name: "cancel_order",
    description:
      "Cancel the current order entirely. " +
      "Use when the customer says 'cancel my order', 'never mind', '算了', 'annuler'. " +
      "Ask for confirmation before cancelling.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Tool handler: executes an order tool call against a given order.
 * Returns the updated order and a human-readable message for the AI to relay.
 *
 * Usage:
 *   const result = handleOrderTool("add_to_cart", { item_id: "smash-burger", quantity: 2 }, currentOrder);
 *   // result.order → updated Order
 *   // result.message → "Added Smash Burger x2"
 */
export function handleOrderTool(
  toolName: string,
  args: Record<string, unknown>,
  order: Order
): { order: Order; message: string } {
  try {
    switch (toolName) {
      case "add_to_cart": {
        const itemId = args["item_id"] as string;
        const quantity = (args["quantity"] as number) ?? 1;
        const option = args["option"] as string | undefined;
        const note = args["note"] as string | undefined;
        return addToCart(order, itemId, quantity, option, note);
      }
      case "remove_from_cart": {
        const index = args["index"] as number;
        return removeFromCart(order, index);
      }
      case "update_quantity": {
        const index = args["index"] as number;
        const quantity = args["quantity"] as number;
        return updateQuantity(order, index, quantity);
      }
      case "get_order": {
        return {
          order,
          message: getOrderSummary(order),
        };
      }
      case "confirm_order": {
        const note = args["note"] as string | undefined;
        return confirmOrder(order, note);
      }
      case "cancel_order": {
        return cancelOrder(order);
      }
      default:
        return {
          order,
          message: `Unknown order tool: ${toolName}`,
        };
    }
  } catch (error) {
    if (error instanceof OrderOperationError) {
      return {
        order: error.order,
        message: `Error: ${error.message}`,
      };
    }
    return {
      order,
      message: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
