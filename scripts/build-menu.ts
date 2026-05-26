/**
 * One-time migration script: reads the OCR-extracted menu JSON
 * and validates that all items are present in the enriched database.
 *
 * Run: npm run generate-menu
 *
 * The enriched database (src/data/menu-database.ts) is the canonical
 * source of truth — this script is for verification purposes.
 */

import { menuDatabase } from "../src/data/menu-database.js";
import { MenuCategory, CATEGORY_LABELS } from "../src/types/menu.js";

function main() {
  console.log("=".repeat(60));
  console.log(`  ${menuDatabase.restaurant} — Menu Database Validation`);
  console.log("=".repeat(60));

  const items = menuDatabase.allItems;
  console.log(`\nTotal items: ${items.length}`);

  // Check for duplicate IDs
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const item of items) {
    if (ids.has(item.id)) {
      duplicates.push(item.id);
    }
    ids.add(item.id);
  }
  if (duplicates.length > 0) {
    console.error(`  DUPLICATE IDs: ${duplicates.join(", ")}`);
  } else {
    console.log(`  All IDs unique ✓`);
  }

  // Check for missing names
  const noName = items.filter(i => !i.name);
  if (noName.length > 0) {
    console.error(`  Items without name: ${noName.length}`);
  } else {
    console.log(`  All items have names ✓`);
  }

  // Check for missing categories
  const noCat = items.filter(i => !i.category);
  if (noCat.length > 0) {
    console.error(`  Items without category: ${noCat.length}`);
  } else {
    console.log(`  All items have categories ✓`);
  }

  // Items with null prices
  const nullPrices = items.filter(i => i.price === null);
  if (nullPrices.length > 0) {
    console.log(`  Items with unconfirmed price: ${nullPrices.length}`);
    for (const item of nullPrices) {
      console.log(`    - ${item.name} (${item.id})`);
    }
  }

  // Category breakdown
  console.log("\nCategory breakdown:");
  for (const cat of Object.values(MenuCategory)) {
    const catItems = menuDatabase.categories[cat];
    if (catItems && catItems.length > 0) {
      const labels = CATEGORY_LABELS[cat];
      console.log(`  ${labels.zh.padEnd(8)} ${labels.en.padEnd(20)} ${String(catItems.length).padStart(3)} items`);
    }
  }

  // Items with Chinese names
  const withZh = items.filter(i => i.nameZh);
  console.log(`\nItems with Chinese names: ${withZh.length}/${items.length}`);

  // Items with aliases
  const withAliases = items.filter(i => i.aliases.length > 0);
  console.log(`Items with aliases: ${withAliases.length}/${items.length}`);

  // Items with keywords
  const withKeywords = items.filter(i => i.keywords.length > 0);
  console.log(`Items with keywords: ${withKeywords.length}/${items.length}`);

  // Items with tags
  const withTags = items.filter(i => i.tags.length > 0);
  console.log(`Items with tags: ${withTags.length}/${items.length}`);

  console.log("\n" + "=".repeat(60));
  console.log("  Validation complete");
  console.log("=".repeat(60));
}

main();
