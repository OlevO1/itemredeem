import { fetchKickletJson } from "@/lib/server/kicklet-request";

const KICKLET_ITEMS_URL =
  "https://kicklet.app/api/shop/eazykeee/item?page=1&pageSize=100";

export type ShopItem = {
  id: string;
  name: string;
  command: string;
  price: number | null;
  stock: number | null;
};

let cache: {
  items: ShopItem[];
  fetchedAt: number;
} | null = null;
let pending: Promise<ShopItem[]> | null = null;

const CACHE_TIME = 60 * 60 * 1000;

function normalizeCommand(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^!shop\s+buy\s+/i, "");
}

function normalizeItem(raw: Record<string, unknown>, index: number): ShopItem | null {
  const name = String(raw.name || "").trim();
  const command = normalizeCommand(raw.command || raw.id || raw.name);

  if (!name || !command) {
    return null;
  }

  return {
    id: String(raw.id || raw.command || name || index),
    name,
    command,
    price: Number.isFinite(Number(raw.price)) ? Number(raw.price) : null,
    stock: Number.isFinite(Number(raw.stock)) ? Number(raw.stock) : null,
  };
}

async function refreshKickletItems() {
  const response = await fetchKickletJson(KICKLET_ITEMS_URL);

  if (!response.ok) {
    throw new Error(`Kicklet items failed (${response.status})`);
  }

  const data = response.data as
    | { items?: unknown[]; data?: unknown[] }
    | unknown[]
    | null;
  const record =
    data && !Array.isArray(data)
      ? (data as { items?: unknown[]; data?: unknown[] })
      : null;
  const rawItems = Array.isArray(record?.items)
    ? record.items
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(data)
        ? data
        : [];

  const items: ShopItem[] = rawItems
    .map((item: unknown, index: number) =>
      normalizeItem((item || {}) as Record<string, unknown>, index),
    )
    .filter((item: ShopItem | null): item is ShopItem => Boolean(item));

  cache = {
    items,
    fetchedAt: Date.now(),
  };

  return items;
}

export async function fetchKickletItems({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TIME) {
    return cache.items;
  }

  if (pending) {
    return pending;
  }

  pending = refreshKickletItems();

  try {
    return await pending;
  } finally {
    pending = null;
  }
}

export async function findKickletItem(itemId: string) {
  const items = await fetchKickletItems();
  const normalized = itemId.trim().toLowerCase();

  return (
    items.find((item) => item.id.toLowerCase() === normalized) ||
    items.find((item) => item.command.toLowerCase() === normalized) ||
    items.find((item) => item.name.toLowerCase() === normalized) ||
    null
  );
}
