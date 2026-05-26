import { describe, it, expect } from "vitest";
import {
  search,
  searchByCategory,
  getByCategory,
  getById,
  getRecommendations,
  getCategories,
} from "../src/services/menu-search.js";
import { MenuCategory } from "../src/types/menu.js";

describe("Menu Search", () => {
  describe("search()", () => {
    it("finds burgers by English query", () => {
      const results = search("burger");
      const names = results.map(r => r.item.name);
      expect(names).toContain("CHEESE BURGER");
      expect(names).toContain("SMASH BURGER");
      expect(names).toContain("CHICKEN BURGER");
      expect(names).toContain("BBQ BURGER");
      expect(names).toContain("SMASH OIGNON BURGER");
      expect(results.length).toBeGreaterThanOrEqual(5);
    });

    it("finds smash burger by alias", () => {
      const results = search("smash");
      expect(results[0]!.item.id).toBe("smash-burger");
    });

    it("finds salmon across categories", () => {
      const results = search("saumon");
      const categories = new Set(results.map(r => r.item.category));
      // Should find salmon in multiple categories
      expect(categories.size).toBeGreaterThanOrEqual(3);
    });

    it("finds light/healthy items with Chinese query 清淡的", () => {
      const results = search("清淡的");
      const names = results.map(r => r.item.name);
      expect(names).toContain("QUINOA POWER");
    });

    it("finds sweet items with Chinese query 甜的", () => {
      const results = search("甜的");
      const names = results.map(r => r.item.name);
      expect(names).toContain("BROWNIE GOURMAND");
      expect(names).toContain("FONDANT AU CHOCOLAT");
    });

    it("finds breakfast items", () => {
      const results = search("breakfast");
      const names = results.map(r => r.item.name);
      expect(names).toContain("AMERICAINE");
      expect(names).toContain("CONTINENTAL");
    });

    it("finds pizza by French query", () => {
      const results = search("pizza");
      const names = results.map(r => r.item.name);
      expect(names).toContain("MARGHERITA");
      expect(names).toContain("4 FROMAGES");
    });

    it("finds coffee drinks", () => {
      const results = search("coffee", 15);
      const names = results.map(r => r.item.name);
      expect(names).toContain("LATTE FRAPPÉ");
      expect(names).toContain("AMERICANO");
    });

    it("handles empty query gracefully", () => {
      const results = search("");
      expect(results).toHaveLength(0);
    });

    it("returns limited results", () => {
      const results = search("burger", 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("ranks exact matches highest", () => {
      const results = search("smash burger");
      expect(results[0]!.item.id).toBe("smash-burger");
      expect(results[0]!.matchType).toBe("exact_name");
    });

    it("finds appetizers / snacks", () => {
      const results = search("snack");
      const names = results.map(r => r.item.name);
      expect(names).toContain("MOZZARELLA STICKS");
      expect(names).toContain("BBQ WINGS");
    });
  });

  describe("searchByCategory()", () => {
    it("filters results by category", () => {
      const results = searchByCategory("burger", MenuCategory.HAMBURGERS);
      for (const r of results) {
        expect(r.item.category).toBe(MenuCategory.HAMBURGERS);
      }
    });
  });

  describe("getByCategory()", () => {
    it("returns all items in a category", () => {
      const items = getByCategory(MenuCategory.HAMBURGERS);
      expect(items.length).toBe(5);
      expect(items.map(i => i.name)).toContain("SMASH BURGER");
    });

    it("returns empty array for empty category", () => {
      // SUPPLEMENTS category items are rolled into BREAKFAST
      const items = getByCategory(MenuCategory.SUPPLEMENTS);
      expect(items).toHaveLength(0);
    });
  });

  describe("getById()", () => {
    it("finds item by slug", () => {
      const item = getById("quinoa-power");
      expect(item).toBeDefined();
      expect(item!.name).toBe("QUINOA POWER");
      expect(item!.price).toBe(8000);
    });

    it("returns undefined for unknown id", () => {
      const item = getById("not-a-real-item");
      expect(item).toBeUndefined();
    });
  });

  describe("getRecommendations()", () => {
    it("recommends light healthy items", () => {
      const items = getRecommendations(["light", "healthy"]);
      expect(items.length).toBeGreaterThan(0);
      const names = items.map(i => i.name);
      expect(names).toContain("QUINOA POWER");
    });

    it("recommends sweet desserts", () => {
      const items = getRecommendations(["sweet", "dessert"]);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.tags).toContain("sweet");
      }
    });

    it("excludes specified items", () => {
      const items = getRecommendations(["burger"], ["smash-burger"]);
      const ids = items.map(i => i.id);
      expect(ids).not.toContain("smash-burger");
    });
  });

  describe("getCategories()", () => {
    it("returns all non-empty categories", () => {
      const cats = getCategories();
      expect(cats.length).toBeGreaterThanOrEqual(10);
      for (const cat of cats) {
        expect(cat.itemCount).toBeGreaterThan(0);
      }
    });

    it("includes multi-language labels", () => {
      const cats = getCategories();
      const breakfast = cats.find(c => c.id === MenuCategory.BREAKFAST);
      expect(breakfast).toBeDefined();
      expect(breakfast!.labels.fr).toBe("Petit Déjeuner");
      expect(breakfast!.labels.en).toBe("Breakfast");
      expect(breakfast!.labels.zh).toBe("早餐");
    });
  });
});
