import type {
  OrderSource,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  PosStatus,
} from "./order.js";

export interface QueuedOrder {
  id: string;
  storeId: string;
  source: OrderSource;
  orderType: OrderType;
  tableNumber?: string;
  items: {
    name: string;
    nameZh?: string;
    quantity: number;
    unitPrice: number;
    option?: string;
    note?: string;
    subtotal: number;
  }[];
  total: number;
  itemCount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  posStatus: PosStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
