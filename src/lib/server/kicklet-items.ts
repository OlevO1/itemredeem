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

export async function fetchKickletItems({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TIME) {
    return cache.items;
  }

  const response = await fetch(KICKLET_ITEMS_URL, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://kicklet.app/user/eazykeee/shop",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kicklet items failed (${response.status})`);
  }

  const data = await response.json();
  const rawItems = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.data)
      ? data.data
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
