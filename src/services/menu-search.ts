import { menuDatabase } from "../data/menu-database.js";
import { MenuCategory, CATEGORY_LABELS, type MenuItem, type SearchResult, type SearchLanguage, type MenuDatabase } from "../types/menu.js";

/**
 * Simple Levenshtein distance for fuzzy matching.
 * Allows ~2 character typos for queries longer than 3 characters.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1,         // deletion
        curr[j - 1]! + 1,     // insertion
        prev[j - 1]! + cost   // substitution
      );
    }
    const temp = prev;
    prev = curr;
    curr = temp;
  }

  return prev[n]!;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9一-鿿\s]/g, "")
    .trim();
}

function tokenize(str: string): string[] {
  return normalize(str).split(/\s+/).filter(Boolean);
}

/**
 * Score an item against a list of query tokens.
 * Returns { score, matchType } or null if no match.
 * Scores are accumulated across tokens — an item matching multiple query tokens ranks higher.
 */
function scoreItem(item: MenuItem, queryTokens: string[]): { score: number; matchType: SearchResult["matchType"] } | null {
  const nameTokens = tokenize(item.name);
  const nameNorm = normalize(item.name);
  const nameZhNorm = item.nameZh ? normalize(item.nameZh) : "";
  const aliasTokens = item.aliases.flatMap(a => tokenize(a));
  const keywordTokens = item.keywords.flatMap(k => tokenize(k));
  const tagTokens = item.tags.flatMap(t => tokenize(t));
  const categoryLabels = CATEGORY_LABELS[item.category];
  const categoryTokens = [
    ...tokenize(categoryLabels.fr),
    ...tokenize(categoryLabels.en),
    ...tokenize(categoryLabels.zh),
    ...tokenize(item.category),
  ];

  let totalScore = 0;
  let bestMatchType: SearchResult["matchType"] = "fuzzy";
  let matched = false;

  for (const qt of queryTokens) {
    let tokenScore = 0;
    let tokenMatchType: SearchResult["matchType"] = "fuzzy";

    // 1. Exact match on name or Chinese name → highest score
    if (nameTokens.some(t => t === qt) || tokenize(nameZhNorm).some(t => t === qt)) {
      tokenScore = 100;
      tokenMatchType = "exact_name";
    }
    // Name contains query token
    else if (nameNorm.includes(qt) || nameZhNorm.includes(qt)) {
      tokenScore = 80;
      tokenMatchType = "exact_name";
    }
    // 2. Alias match
    else if (aliasTokens.some(t => t === qt)) {
      tokenScore = 70;
      tokenMatchType = "alias";
    }
    else if (aliasTokens.some(t => t.includes(qt) || qt.includes(t))) {
      tokenScore = 60;
      tokenMatchType = "alias";
    }
    // 3. Keyword match
    else if (keywordTokens.some(t => t === qt)) {
      tokenScore = 50;
      tokenMatchType = "keyword";
    }
    else if (keywordTokens.some(t => t.includes(qt) || qt.includes(t))) {
      tokenScore = 40;
      tokenMatchType = "keyword";
    }
    // 4. Tag match
    else if (tagTokens.some(t => t === qt)) {
      tokenScore = 45;
      tokenMatchType = "tag";
    }
    else if (tagTokens.some(t => t.includes(qt) || qt.includes(t))) {
      tokenScore = 35;
      tokenMatchType = "tag";
    }
    // 5. Category match
    else if (categoryTokens.some(t => t === qt)) {
      tokenScore = 30;
      tokenMatchType = "category";
    }
    else if (categoryTokens.some(t => t.includes(qt) || qt.includes(t))) {
      tokenScore = 20;
      tokenMatchType = "category";
    }
    // 6. Fuzzy match on name (Levenshtein)
    else {
      for (const nt of nameTokens) {
        if (nt.length < 3 || qt.length < 3) continue;
        const dist = levenshtein(nt, qt);
        const maxLen = Math.max(nt.length, qt.length);
        const similarity = 1 - dist / maxLen;
        if (similarity >= 0.7) {
          const fuzzyScore = 15 * similarity;
          if (fuzzyScore > tokenScore) {
            tokenScore = fuzzyScore;
            tokenMatchType = "fuzzy";
          }
        }
      }
    }

    if (tokenScore > 0) {
      totalScore += tokenScore;
      matched = true;
      if (tokenScore > 0 && (bestMatchType === "fuzzy" || tokenScore >= 70)) {
        bestMatchType = tokenMatchType;
      }
    }
  }

  if (!matched) return null;
  return { score: totalScore, matchType: bestMatchType };
}

/**
 * Map Chinese taste/preference words to common tags.
 * This enables cross-language queries like "清淡的" → matching items tagged "light".
 */
const PREFERENCE_MAP: Record<string, string[]> = {
  "清淡": ["light", "healthy", "fresh", "clean"],
  "清淡的": ["light", "healthy", "fresh", "clean"],
  "轻食": ["light", "healthy", "fresh"],
  "健康": ["healthy", "light", "clean", "fresh"],
  "甜的": ["sweet", "dessert"],
  "甜": ["sweet", "dessert"],
  "甜食": ["sweet", "dessert"],
  "辣": ["spicy"],
  "辣的": ["spicy"],
  "热的": ["hot", "warm"],
  "热": ["hot", "warm"],
  "冰": ["cold", "iced"],
  "冷": ["cold", "iced"],
  "纯素": ["vegan", "vegetarian"],
  "素食": ["vegetarian", "vegan"],
  "肉": ["meat", "hearty"],
  "海鲜": ["seafood"],
  "鱼": ["seafood", "fish"],
  "清爽": ["fresh", "light", "cold"],
  "浓郁": ["rich", "hearty"],
  "脆": ["crunchy", "fried"],
  "酥": ["crunchy", "fried"],
};

/**
 * Expand query tokens with preference translations.
 */
function expandTokens(tokens: string[]): string[] {
  const expanded = [...tokens];
  for (const t of tokens) {
    const mapped = PREFERENCE_MAP[t];
    if (mapped) expanded.push(...mapped);
  }
  return expanded;
}

/**
 * Search the full menu database for items matching a natural language query.
 * Results are ranked by relevance score (descending).
 *
 * @param query - Natural language query in any supported language
 * @param limit - Max results to return (default 10)
 * @returns Ranked search results
 */
export function search(query: string, limit = 10): SearchResult[] {
  if (!query.trim()) return [];

  const tokens = tokenize(query);
  const expandedTokens = expandTokens(tokens);
  const results: SearchResult[] = [];

  for (const item of menuDatabase.allItems) {
    const scored = scoreItem(item, expandedTokens);
    if (scored) {
      results.push({ item, score: scored.score, matchType: scored.matchType });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Search within a specific category.
 */
export function searchByCategory(query: string, category: MenuCategory, limit = 10): SearchResult[] {
  const all = search(query, 100);
  return all.filter(r => r.item.category === category).slice(0, limit);
}

/**
 * Get all items in a category.
 */
export function getByCategory(category: MenuCategory): MenuItem[] {
  return menuDatabase.categories[category] ?? [];
}

/**
 * Get a single item by its unique ID slug.
 */
export function getById(id: string): MenuItem | undefined {
  return menuDatabase.allItems.find(item => item.id === id);
}

/**
 * Get recommendations based on preference tags or category.
 *
 * @param preferences - Tags or preferences to match (e.g. "light", "sweet", "vegetarian", "burger")
 * @param excludeIds - Item IDs to exclude from results
 * @param limit - Max results
 */
export function getRecommendations(preferences: string[], excludeIds: string[] = [], limit = 6): MenuItem[] {
  const prefTokens = preferences.flatMap(p => tokenize(p));
  const expandedPrefs = expandTokens(prefTokens);
  const results: SearchResult[] = [];

  for (const item of menuDatabase.allItems) {
    if (excludeIds.includes(item.id)) continue;
    const scored = scoreItem(item, expandedPrefs);
    if (scored && scored.score >= 30) { // minimum relevance threshold
      results.push({ item, score: scored.score, matchType: scored.matchType });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(r => r.item);
}

/**
 * Get all category labels for display.
 */
export function getCategories(): { id: MenuCategory; labels: { fr: string; en: string; zh: string }; itemCount: number }[] {
  return Object.values(MenuCategory)
    .filter(cat => {
      const items = menuDatabase.categories[cat];
      return items && items.length > 0;
    })
    .map(cat => ({
      id: cat,
      labels: CATEGORY_LABELS[cat],
      itemCount: menuDatabase.categories[cat]?.length ?? 0,
    }));
}

/**
 * Get the full menu database (read-only).
 */
export function getDatabase(): Readonly<MenuDatabase> {
  return menuDatabase;
}
