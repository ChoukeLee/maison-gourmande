/** All 10 menu categories at Maison Gourmande */
export enum MenuCategory {
  BREAKFAST = "breakfast",
  SALADES = "salades",
  APERITIFS = "aperitifs",
  PIZZAS = "pizzas",
  PATES = "pates",
  PLATS = "plats",
  SANDWICHES = "sandwiches",
  HAMBURGERS = "hamburgers",
  CREPES_GAUFRES = "crepes_gaufres",
  DESSERTS = "desserts",
  GLACES = "glaces",
  BOISSONS = "boissons",
  COCKTAILS = "cocktails_alcool",
  MOCKTAILS = "mocktails",
  MILKSHAKE = "milkshake",
  VIN = "vin",
  BIERES_ALCOOLS = "bieres_alcools",
  SUPPLEMENTS = "supplements",
}

export const CATEGORY_LABELS: Record<MenuCategory, { fr: string; en: string; zh: string }> = {
  [MenuCategory.BREAKFAST]:       { fr: "Petit Déjeuner",   en: "Breakfast",         zh: "早餐" },
  [MenuCategory.SALADES]:         { fr: "Salades",          en: "Salads",            zh: "沙拉" },
  [MenuCategory.APERITIFS]:       { fr: "Apéritifs",       en: "Appetizers",        zh: "开胃菜" },
  [MenuCategory.PIZZAS]:          { fr: "Pizzas",           en: "Pizzas",            zh: "披萨" },
  [MenuCategory.PATES]:           { fr: "Pâtes",            en: "Pasta",             zh: "意面" },
  [MenuCategory.PLATS]:           { fr: "Plats",            en: "Main Courses",      zh: "主菜" },
  [MenuCategory.SANDWICHES]:      { fr: "Sandwiches",       en: "Sandwiches",        zh: "三明治" },
  [MenuCategory.HAMBURGERS]:      { fr: "Hamburgers",       en: "Hamburgers",        zh: "汉堡" },
  [MenuCategory.CREPES_GAUFRES]:  { fr: "Crêpes & Gaufres", en: "Crepes & Waffles",  zh: "可丽饼和华夫" },
  [MenuCategory.DESSERTS]:        { fr: "Desserts",         en: "Desserts",          zh: "甜点" },
  [MenuCategory.GLACES]:          { fr: "Glaces",           en: "Ice Cream",         zh: "冰淇淋" },
  [MenuCategory.BOISSONS]:        { fr: "Boissons",         en: "Beverages",         zh: "饮品" },
  [MenuCategory.COCKTAILS]:       { fr: "Cocktails",        en: "Cocktails",         zh: "鸡尾酒" },
  [MenuCategory.MOCKTAILS]:       { fr: "Mocktails",        en: "Mocktails",         zh: "无酒精鸡尾酒" },
  [MenuCategory.MILKSHAKE]:       { fr: "Milkshake",        en: "Milkshake",         zh: "奶昔" },
  [MenuCategory.VIN]:             { fr: "Vin",              en: "Wine",              zh: "红酒" },
  [MenuCategory.BIERES_ALCOOLS]:  { fr: "Bières & Alcools", en: "Beer & Spirits",   zh: "啤酒和烈酒" },
  [MenuCategory.SUPPLEMENTS]:     { fr: "Suppléments",      en: "Extras",            zh: "加料" },
};

/** Core menu item — everything the AI needs to understand a dish */
export interface MenuItem {
  /** Unique slug: "smash-burger" */
  id: string;
  /** Display name: "SMASH BURGER" */
  name: string;
  /** Chinese name: "招牌碎肉汉堡" */
  nameZh?: string;
  /** Category this item belongs to */
  category: MenuCategory;
  /** Price in FCFA. null if price varies or is unconfirmed */
  price: number | null;
  /** Common ways customers refer to this item (multi-language) */
  aliases: string[];
  /** Ingredients, flavors, dietary attributes (multi-language) */
  keywords: string[];
  /** French description */
  descriptionFr?: string;
  /** English description */
  descriptionEn?: string;
  /** Available options/variants (e.g. pasta type, side dish) */
  options?: { name: string; price?: number }[];
  /** Dietary/preference labels: "vegetarian", "spicy", "light", "sweet" */
  tags: string[];
}

/** Top-level menu database */
export interface MenuDatabase {
  restaurant: string;
  currency: string;
  categories: Partial<Record<MenuCategory, MenuItem[]>>;
  /** Flat list of all items for search */
  allItems: MenuItem[];
}

/** A single ranked search result */
export interface SearchResult {
  item: MenuItem;
  score: number;
  matchType: "exact_name" | "alias" | "keyword" | "category" | "tag" | "fuzzy";
}

/** Language for search queries */
export type SearchLanguage = "fr" | "en" | "zh";
