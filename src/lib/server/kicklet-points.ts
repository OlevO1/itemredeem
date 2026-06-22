import {
  normalizeKickletApiToken,
  requestKickletJson,
} from "@/lib/server/kicklet-request";

const DEFAULT_KICKLET_KICK_ID = "4000584";
const POINTS_CACHE_MS = 20_000;
const POINTS_CACHE_MAX_ENTRIES = 500;

export type KickletPoints = {
  ok: boolean;
  found: boolean;
  viewer: string;
  points: number;
  status?: number;
  unavailable?: boolean;
  viewerKickUserID?: number | string | null;
  error?: string;
};

export type KickletPointChange = KickletPoints & {
  requestedPoints: number;
  beforePoints: number | null;
  afterPoints: number | null;
  expectedAfterPoints: number | null;
  verified: boolean;
};

const pointsCache = new Map<
  string,
  {
    expiresAt: number;
    value: KickletPoints;
  }
>();

function cleanViewer(value: string) {
  return value.trim().replace(/^@+/, "");
}

function getKickletKickId() {
  return (
    process.env.KICKLET_PUBLIC_KICK_ID ||
    process.env.KICKLET_KICK_ID ||
    process.env.KICK_ID ||
    DEFAULT_KICKLET_KICK_ID
  ).trim();
}

function getKickletApiToken() {
  return normalizeKickletApiToken(
    process.env.KICKLET_API_TOKEN || process.env.KICKLET_TOKEN || "",
  );
}

function cacheKey(viewer: string) {
  return `${getKickletKickId()}:${cleanViewer(viewer).toLowerCase()}`;
}

function getCachedPoints(viewer: string) {
  const key = cacheKey(viewer);
  const cached = pointsCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    pointsCache.delete(key);
    return null;
  }

  return { ...cached.value };
}

function setCachedPoints(viewer: string, value: KickletPoints) {
  const now = Date.now();

  for (const [key, cached] of pointsCache) {
    if (cached.expiresAt <= now) {
      pointsCache.delete(key);
    }
  }

  while (pointsCache.size >= POINTS_CACHE_MAX_ENTRIES) {
    const oldestKey = pointsCache.keys().next().value;
    if (!oldestKey) break;
    pointsCache.delete(oldestKey);
  }

  pointsCache.set(cacheKey(viewer), {
    expiresAt: now + POINTS_CACHE_MS,
    value: { ...value },
  });
}

function invalidateCachedPoints(viewer: string) {
  pointsCache.delete(cacheKey(viewer));
}

function viewerRankingUrl(viewer: string) {
  const url = new URL(
    `https://kicklet.app/api/stats/public/${encodeURIComponent(
      getKickletKickId(),
    )}/viewer/ranking`,
  );

  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "watchtime");
  url.searchParams.set("order", "desc");
  url.searchParams.set("search", cleanViewer(viewer));

  return url.toString();
}

function findViewerRanking(data: unknown, viewer: string) {
  const normalized = cleanViewer(viewer).toLowerCase();
  const rows = Array.isArray((data as { ranking?: unknown[] })?.ranking)
    ? ((data as { ranking: unknown[] }).ranking)
    : [];

  return (
    rows.find((row) => {
      const name = String(
        (row as { viewerKickUsername?: unknown })?.viewerKickUsername || "",
      )
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();

      return name === normalized;
    }) || null
  );
}

async function fetchViewerPoints(viewer: string): Promise<KickletPoints> {
  const clean = cleanViewer(viewer);
  const response = await requestKickletJson(viewerRankingUrl(clean));

  if (!response.ok) {
    return {
      ok: false,
      found: false,
      viewer: clean,
      points: 0,
      status: response.status,
      unavailable: response.unavailable,
      error: response.unavailable
        ? "Kicklet API jelenleg nem elérhető"
        : `Kicklet pontlekérés sikertelen (${response.status})`,
    };
  }

  const row = findViewerRanking(response.data, clean) as {
    points?: unknown;
    viewerKickUserID?: unknown;
    viewerKickUsername?: unknown;
  } | null;
  const points = Number(row?.points);

  if (!row || !Number.isFinite(points)) {
    return {
      ok: true,
      found: false,
      viewer: clean,
      points: 0,
      status: response.status,
      error: "Kicklet user nem található",
    };
  }

  return {
    ok: true,
    found: true,
    viewer: String(row.viewerKickUsername || clean),
    points,
    status: response.status,
    viewerKickUserID:
      typeof row.viewerKickUserID === "number" ||
      typeof row.viewerKickUserID === "string"
        ? row.viewerKickUserID
        : null,
  };
}

export async function lookupKickletPoints(
  viewer: string,
  { force = false }: { force?: boolean } = {},
): Promise<KickletPoints> {
  const clean = cleanViewer(viewer);

  if (!clean) {
    return {
      ok: false,
      found: false,
      viewer: clean,
      points: 0,
      error: "Hiányzó Kick felhasználónév",
    };
  }

  if (!force) {
    const cached = getCachedPoints(clean);
    if (cached) {
      return cached;
    }
  }

  const result = await fetchViewerPoints(clean);

  if (result.ok) {
    setCachedPoints(clean, result);
  }

  return result;
}

export async function changeKickletPoints(
  viewer: string,
  delta: number,
): Promise<KickletPointChange> {
  const clean = cleanViewer(viewer);
  const amount = Number(delta);
  const apiToken = getKickletApiToken();
  const emptyResult = {
    viewer: clean,
    requestedPoints: Number.isInteger(amount) ? amount : 0,
    beforePoints: null,
    afterPoints: null,
    expectedAfterPoints: null,
    verified: false,
  };

  if (!clean || !Number.isInteger(amount) || amount === 0 || !apiToken) {
    return {
      ...emptyResult,
      ok: false,
      found: false,
      points: 0,
      error: "Hiányzó Kicklet token, felhasználónév vagy pontmennyiség",
    };
  }

  const before = await lookupKickletPoints(clean, { force: true });

  if (!before.ok || !before.found) {
    return {
      ...emptyResult,
      ...before,
      beforePoints: before.found ? before.points : null,
      error: before.error || "A pontmódosítás előtti lekérdezés sikertelen",
    };
  }

  const kickId = getKickletKickId();
  const encodedViewer = encodeURIComponent(clean);
  const absoluteAmount = Math.abs(amount);
  const paths =
    amount > 0
      ? [`add/${absoluteAmount}`]
      : [
          `add/${amount}`,
          `subtract/${absoluteAmount}`,
          `remove/${absoluteAmount}`,
        ];
  let mutation:
    | Awaited<ReturnType<typeof requestKickletJson>>
    | null = null;

  for (const path of paths) {
    mutation = await requestKickletJson(
      `https://kicklet.app/api/stats/${encodeURIComponent(
        kickId,
      )}/points/${encodedViewer}/${path}`,
      {
        method: "PATCH",
        apiToken,
      },
    );

    if (mutation.ok) {
      break;
    }

    if (![400, 404, 405].includes(mutation.status)) {
      break;
    }
  }

  const expectedAfterPoints = Math.max(0, before.points + amount);

  if (!mutation?.ok) {
    return {
      ...emptyResult,
      ok: false,
      found: true,
      points: before.points,
      status: mutation?.status,
      unavailable: mutation?.unavailable,
      beforePoints: before.points,
      expectedAfterPoints,
      error: mutation?.unavailable
        ? "Kicklet API jelenleg nem elérhető"
        : `Kicklet pontmódosítás sikertelen (${mutation?.status || 0})`,
    };
  }

  invalidateCachedPoints(clean);
  const after = await lookupKickletPoints(clean, { force: true });
  const verified =
    after.ok &&
    after.found &&
    (amount > 0
      ? after.points >= expectedAfterPoints
      : after.points <= expectedAfterPoints);

  if (!verified) {
    return {
      ...emptyResult,
      ok: false,
      found: after.found,
      points: after.points,
      status: after.status || mutation.status,
      unavailable: after.unavailable,
      beforePoints: before.points,
      afterPoints: after.found ? after.points : null,
      expectedAfterPoints,
      error:
        after.error ||
        "A Kicklet pontmódosítás utáni ellenőrzése sikertelen",
    };
  }

  return {
    ...emptyResult,
    ...after,
    ok: true,
    found: true,
    points: after.points,
    status: mutation.status,
    beforePoints: before.points,
    afterPoints: after.points,
    expectedAfterPoints,
    verified: true,
  };
}
