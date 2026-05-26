// Maison Gourmande — Menu Database + Order Engine
// Public API

// ─── Types ───────────────────────────────────────────────
export {
  MenuCategory,
  CATEGORY_LABELS,
  type MenuItem,
  type MenuDatabase,
  type SearchResult,
  type SearchLanguage,
} from "./types/menu.js";

export {
  OrderStatus,
  STATUS_TRANSITIONS,
  STATUS_LABELS,
  OrderError,
  type CartItem,
  type Order,
  type OrderOperationResult,
} from "./types/order.js";

// ─── Data ────────────────────────────────────────────────
export { menuDatabase } from "./data/menu-database.js";

// ─── Menu Services ───────────────────────────────────────
export {
  search,
  searchByCategory,
  getByCategory,
  getById,
  getRecommendations,
  getCategories,
  getDatabase,
} from "./services/menu-search.js";

export {
  menuTools,
  type MenuTool,
  type ToolHandler,
} from "./services/menu-tools.js";

// ─── Order Services ──────────────────────────────────────
export {
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
} from "./services/order-engine.js";

export {
  orderTools,
  handleOrderTool,
} from "./services/order-tools.js";

// ─── Conversation Memory ─────────────────────────────────
export {
  createMemory,
  formatMemoryContext,
  type ConversationMemory,
  type ShownType,
} from "./types/memory.js";

// ─── AI Agent ────────────────────────────────────────────
export {
  chat,
  newConversation,
  type ChatResult,
} from "./services/agent.js";
