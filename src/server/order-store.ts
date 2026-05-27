import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { QueuedOrder } from "../types/queued-order.js";

const DATA_DIR = process.env["MG_DATA_DIR"] ?? path.resolve(process.cwd(), "runtime-data");
const ORDER_FILE = path.join(DATA_DIR, "orders.json");

export async function loadOrderQueue(): Promise<QueuedOrder[]> {
  try {
    const raw = await readFile(ORDER_FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn(`Order store ignored invalid payload in ${ORDER_FILE}`);
      return [];
    }
    return parsed as QueuedOrder[];
  } catch (error) {
    if (isMissingFileError(error)) return [];
    console.error("Failed to load order store:", error);
    return [];
  }
}

export async function saveOrderQueue(orders: QueuedOrder[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${ORDER_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(orders, null, 2), "utf8");
  await rename(tempFile, ORDER_FILE);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
