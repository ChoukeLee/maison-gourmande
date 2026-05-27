export interface MenuItemOverride {
  price?: number | null;
  soldOut?: boolean;
  hidden?: boolean;
  recommended?: boolean;
  note?: string;
  updatedAt: number;
}

export type MenuOverrides = Record<string, MenuItemOverride>;
