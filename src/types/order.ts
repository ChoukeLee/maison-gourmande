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

export enum OrderType {
  DINE_IN = "dine_in",
  TAKEAWAY = "takeaway",
  DELIVERY = "delivery",
}

export enum OrderSource {
  WEB = "web",
  WHATSAPP = "whatsapp",
  STAFF = "staff",
}

export enum PaymentStatus {
  UNPAID = "unpaid",
  PENDING = "pending",
  PAID = "paid",
  REFUNDED = "refunded",
}

export enum PaymentMethod {
  UNKNOWN = "unknown",
  CASH = "cash",
  WAVE = "wave",
  ORANGE_MONEY = "orange_money",
  CARD = "card",
}

export enum PosStatus {
  NOT_ENTERED = "not_entered",
  ENTERED = "entered",
}

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
  /** Restaurant identifier, kept for future multi-tenant expansion */
  storeId: string;
  /** Where the order came from */
  source: OrderSource;
  /** Dine-in, takeaway, or delivery */
  orderType: OrderType;
  /** Optional table number for dine-in orders */
  tableNumber?: string;
  /** Line items */
  items: CartItem[];
  /** Current status */
  status: OrderStatus;
  /** Payment collection status */
  paymentStatus: PaymentStatus;
  /** Payment method selected or recorded by staff */
  paymentMethod: PaymentMethod;
  /** Whether cashier has entered this order in the existing POS */
  posStatus: PosStatus;
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
  ITEM_UNAVAILABLE = "ITEM_UNAVAILABLE",
}
