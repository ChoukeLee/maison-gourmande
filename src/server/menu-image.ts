import { CATEGORY_LABELS, MenuCategory, type MenuItem } from "../types/menu.js";

interface MenuImageItem extends MenuItem {
  soldOut?: boolean;
  hidden?: boolean;
  recommended?: boolean;
}

export function detectMenuImageRequest(message: string): { category?: MenuCategory; recommended?: boolean } | null {
  const text = message.toLowerCase();
  const wantsMenu = includesAny(text, [
    "menu", "carte", "show me", "send", "voir", "看看", "菜单", "菜單", "发", "發", "图片", "圖片", "photo",
  ]);
  if (!wantsMenu) return null;

  if (includesAny(text, ["recommend", "recommended", "today", "special", "suggest", "推荐", "推薦", "今日"])) {
    return { recommended: true };
  }

  const category = detectCategory(text);
  return { category: category ?? MenuCategory.BREAKFAST };
}

export function renderMenuImageSvg(params: {
  title: string;
  subtitle: string;
  items: MenuImageItem[];
  generatedAt?: Date;
}): string {
  const width = 1080;
  const rowHeight = 92;
  const visibleItems = params.items.slice(0, 18);
  const height = Math.max(1280, 330 + visibleItems.length * rowHeight);
  const generatedAt = params.generatedAt ?? new Date();

  const rows = visibleItems.map((item, index) => {
    const y = 330 + index * rowHeight;
    const name = item.soldOut ? `${item.name}  ·  SOLD OUT` : item.name;
    const price = item.price == null ? "Variable" : `${item.price.toLocaleString("fr-FR")} FCFA`;
    const desc = item.descriptionEn ?? item.descriptionFr ?? item.tags.slice(0, 3).join(" · ");
    const badge = item.recommended
      ? `<text x="830" y="${y + 34}" fill="#123d35" font-family="Inter, Arial" font-size="24" font-weight="700">Recommended</text>`
      : "";
    return `
      <g opacity="${item.soldOut ? "0.46" : "1"}">
        <text x="92" y="${y + 28}" fill="#27231d" font-family="Georgia, serif" font-size="34" font-weight="600">${escapeSvg(name)}</text>
        <text x="92" y="${y + 62}" fill="#827666" font-family="Inter, Arial" font-size="22">${escapeSvg(truncate(desc, 82))}</text>
        <text x="928" y="${y + 30}" fill="#27231d" font-family="Inter, Arial" font-size="26" font-weight="800" text-anchor="end">${escapeSvg(price)}</text>
        ${badge}
        <line x1="92" y1="${y + 82}" x2="988" y2="${y + 82}" stroke="#ddcfba" stroke-width="2" stroke-dasharray="5 8"/>
      </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="1080" height="${height}" fill="#f6efe3"/>
  <rect x="32" y="32" width="1016" height="${height - 64}" fill="none" stroke="#d5bd8a" stroke-width="3"/>
  <circle cx="540" cy="110" r="48" fill="none" stroke="#b7904b" stroke-width="3"/>
  <text x="540" y="125" fill="#123d35" font-family="Georgia, serif" font-size="32" font-style="italic" font-weight="700" text-anchor="middle">MG</text>
  <text x="540" y="205" fill="#27231d" font-family="Georgia, serif" font-size="56" font-weight="500" text-anchor="middle" letter-spacing="2">MAISON GOURMANDE</text>
  <text x="540" y="255" fill="#b7904b" font-family="Inter, Arial" font-size="22" font-weight="800" text-anchor="middle" letter-spacing="5">${escapeSvg(params.subtitle.toUpperCase())}</text>
  <text x="92" y="305" fill="#27231d" font-family="Georgia, serif" font-size="42" font-weight="500">${escapeSvg(params.title)}</text>
  ${rows}
  <text x="540" y="${height - 78}" fill="#827666" font-family="Inter, Arial" font-size="22" text-anchor="middle">Generated ${escapeSvg(generatedAt.toLocaleDateString("fr-FR"))} · Prices in FCFA</text>
</svg>`;
}

export function titleForMenuImage(category?: MenuCategory, recommended?: boolean): { title: string; subtitle: string } {
  if (recommended) return { title: "Today's Recommendations", subtitle: "La selection du jour" };
  if (!category) return { title: "Menu", subtitle: "La carte" };
  const labels = CATEGORY_LABELS[category];
  return { title: labels.en, subtitle: labels.fr };
}

function detectCategory(text: string): MenuCategory | null {
  const entries: [MenuCategory, string[]][] = [
    [MenuCategory.BREAKFAST, ["breakfast", "brunch", "petit", "dejeuner", "déjeuner", "早餐"]],
    [MenuCategory.SALADES, ["salad", "salade", "salades", "沙拉"]],
    [MenuCategory.PIZZAS, ["pizza", "pizzas", "披萨", "披薩"]],
    [MenuCategory.PATES, ["pasta", "pate", "pates", "pâtes", "意面"]],
    [MenuCategory.PLATS, ["main", "plat", "plats", "dish", "主菜"]],
    [MenuCategory.SANDWICHES, ["sandwich", "sandwiches", "三明治"]],
    [MenuCategory.HAMBURGERS, ["burger", "hamburger", "汉堡", "漢堡"]],
    [MenuCategory.DESSERTS, ["dessert", "desserts", "sweet", "甜点", "甜品"]],
    [MenuCategory.BOISSONS, ["drink", "drinks", "boisson", "boissons", "coffee", "cafe", "café", "饮品", "饮料", "咖啡"]],
    [MenuCategory.MOCKTAILS, ["mocktail", "mocktails", "无酒精"]],
    [MenuCategory.COCKTAILS, ["cocktail", "cocktails", "酒"]],
  ];
  return entries.find(([, terms]) => includesAny(text, terms))?.[0] ?? null;
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some(term => text.includes(term));
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeSvg(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
