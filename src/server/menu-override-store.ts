import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MenuItemOverride, MenuOverrides } from "../types/menu-overrides.js";

const DATA_DIR = process.env["MG_DATA_DIR"] ?? path.resolve(process.cwd(), "runtime-data");
const OVERRIDE_FILE = path.join(DATA_DIR, "menu-overrides.json");

let overrides: MenuOverrides = process.env["VITEST"] ? {} : loadMenuOverrides();

export function getMenuOverrides(): MenuOverrides {
  return { ...overrides };
}

export function getMenuOverride(itemId: string): MenuItemOverride | undefined {
  return overrides[itemId];
}

export function updateMenuOverride(itemId: string, patch: Partial<Omit<MenuItemOverride, "updatedAt">>): MenuItemOverride {
  const current = overrides[itemId] ?? { updatedAt: Date.now() };
  const next: MenuItemOverride = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };

  for (const key of ["price", "soldOut", "hidden", "recommended", "note"] as const) {
    if (patch[key] === undefined) continue;
    if (next[key] === undefined || next[key] === "") {
      delete next[key];
    }
  }

  overrides = { ...overrides, [itemId]: next };
  saveMenuOverrides();
  return next;
}

function loadMenuOverrides(): MenuOverrides {
  try {
    if (!existsSync(OVERRIDE_FILE)) return {};
    const parsed = JSON.parse(readFileSync(OVERRIDE_FILE, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as MenuOverrides;
  } catch (error) {
    console.error("Failed to load menu overrides:", error);
    return {};
  }
}

function saveMenuOverrides(): void {
  if (process.env["VITEST"]) return;
  mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${OVERRIDE_FILE}.tmp`;
  writeFileSync(tempFile, JSON.stringify(overrides, null, 2), "utf8");
  renameSync(tempFile, OVERRIDE_FILE);
}
