/**
 * Claude API Tool Definitions for the Maison Gourmande Menu.
 *
 * These tool schemas define the interface between the AI Agent and the
 * Menu Database / Order Engine. The AI calls these tools; the backend
 * executes them and returns structured results.
 *
 * Usage with Anthropic SDK:
 *   import { menuTools } from "./menu-tools.js";
 *   const response = await anthropic.messages.create({
 *     model: "claude-sonnet-4-6",
 *     tools: menuTools,
 *     messages: [...],
 *   });
 */

/** Tool definition shape compatible with Claude API / Anthropic SDK */
export interface MenuTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const menuTools: MenuTool[] = [
  {
    name: "search_menu",
    description:
      "Search the restaurant menu for items matching a natural language query. " +
      "Use when a customer asks about food, mentions a dish name, ingredient, or preference. " +
      "Supports English, French, and Chinese queries. Returns ranked results with scores.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural language search query in any supported language (fr/en/zh). E.g. 'burger', '清淡的', 'quelque chose de sucre', 'salmon'",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 10, max 20)",
          default: 10,
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_menu_category",
    description:
      "Get all items in a specific menu category. " +
      "Use when a customer asks to see a category like 'show me the burgers', 'what pizzas do you have', '甜点有哪些'.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: [
            "breakfast", "salades", "aperitifs", "pizzas", "pates", "plats",
            "sandwiches", "hamburgers", "crepes_gaufres", "desserts", "glaces",
            "boissons", "cocktails_alcool", "mocktails", "milkshake", "vin", "bieres_alcools",
          ],
          description: "The menu category ID to retrieve",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "get_menu_item",
    description:
      "Get detailed information about a specific menu item by its ID. " +
      "Use when a customer asks about a specific dish that was previously mentioned or when confirming details.",
    input_schema: {
      type: "object",
      properties: {
        item_id: {
          type: "string",
          description: "The unique ID slug of the menu item (e.g. 'smash-burger', 'quinoa-power')",
        },
      },
      required: ["item_id"],
    },
  },
  {
    name: "get_menu_categories",
    description:
      "List all available menu categories with their item counts. " +
      "Use when a customer asks 'what do you have?' or 'show me the menu' to give an overview.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_recommendations",
    description:
      "Get personalized menu recommendations based on preferences, dietary needs, or occasion. " +
      "Use when a customer says things like 'I want something light', '推荐一个甜点', 'recommend me breakfast', " +
      "'有什么清淡的吗', or when you want to suggest items proactively.",
    input_schema: {
      type: "object",
      properties: {
        preferences: {
          type: "array",
          items: { type: "string" },
          description: "List of preference tags. Examples: ['light', 'healthy'], ['sweet', 'dessert'], ['vegetarian'], ['burger'], ['spicy']",
        },
        exclude_ids: {
          type: "array",
          items: { type: "string" },
          description: "Item IDs to exclude (e.g. items already in the cart or already shown)",
        },
        limit: {
          type: "number",
          description: "Max recommendations (default 6)",
          default: 6,
        },
      },
      required: ["preferences"],
    },
  },
];

/** Handler map: tool name → handler function */
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export { menuDatabase } from "../data/menu-database.js";
export { search, getByCategory, getById, getRecommendations, getCategories, getDatabase } from "./menu-search.js";
