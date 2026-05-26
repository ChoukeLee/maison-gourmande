/** Order lifecycle states */
export enum OrderStatus {
  /** Being built via conversation — items can be added/removed */
  DRAFT = "draft",
  /** Customer confirmed — order locked for kitchen */
  CONFIRMED = "confirmed",
  /** Kitchen has started preparation */
  PREPARING = "preparing",
  /** Order is ready for pickup/delivery */
  READY = "ready",
  /** Delivered to customer / served at table */
  COMPLETED = "completed",
  /** Order was cancelled */
  CANCELLED = "cancelled",
}

/** Status transition map — which statuses can move to which */
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.DRAFT]:     [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY, OrderStatus.CANCELLED],
  [OrderStatus.READY]:     [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

export const STATUS_LABELS: Record<OrderStatus, { fr: string; en: string; zh: string }> = {
  [OrderStatus.DRAFT]:     { fr: "Brouillon",   en: "Draft",       zh: "未确认" },
  [OrderStatus.CONFIRMED]: { fr: "Confirmé",    en: "Confirmed",   zh: "已确认" },
  [OrderStatus.PREPARING]: { fr: "En cuisine",  en: "Preparing",   zh: "制作中" },
  [OrderStatus.READY]:     { fr: "Prêt",        en: "Ready",       zh: "待取餐" },
  [OrderStatus.COMPLETED]: { fr: "Terminé",     en: "Completed",   zh: "已完成" },
  [OrderStatus.CANCELLED]: { fr: "Annulé",      en: "Cancelled",   zh: "已取消" },
};

/** A single line item in the cart */
export interface CartItem {
  /** References MenuItem.id */
  menuItemId: string;
  /** Denormalized display name */
  name: string;
  /** Chinese name */
  nameZh?: string;
  /** Quantity ordered */
  quantity: number;
  /** Price per unit in FCFA */
  unitPrice: number;
  /** Selected variant, e.g. "Spaghetti", "Rouge", "Vanille" */
  selectedOption?: string;
  /** Per-item special instruction, e.g. "少辣", "extra sauce", "no onions" */
  note?: string;
  /** Timestamp when the item was added */
  addedAt: number;
}

/** A customer order */
export interface Order {
  /** Unique order ID */
  id: string;
  /** Line items */
  items: CartItem[];
  /** Current status */
  status: OrderStatus;
  /** Total price in FCFA */
  total: number;
  /** Total quantity of all items */
  itemCount: number;
  /** Order creation timestamp */
  createdAt: number;
  /** Last modification timestamp */
  updatedAt: number;
  /** Optional customer note */
  note?: string;
}

/** Result of an order operation — contains the new order and a description of what happened */
export interface OrderOperationResult {
  order: Order;
  /** Human-readable message about what changed, for the AI to relay */
  message: string;
}

/** Error codes for invalid operations */
export enum OrderError {
  EMPTY_CART = "EMPTY_CART",
  ITEM_NOT_FOUND = "ITEM_NOT_FOUND",
  PRICE_NOT_CONFIRMED = "PRICE_NOT_CONFIRMED",
  INVALID_INDEX = "INVALID_INDEX",
  INVALID_STATUS = "INVALID_STATUS",
  ORDER_ALREADY_CONFIRMED = "ORDER_ALREADY_CONFIRMED",
  ORDER_NOT_DRAFT = "ORDER_NOT_DRAFT",
}
