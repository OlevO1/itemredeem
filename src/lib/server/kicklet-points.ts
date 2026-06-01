const DEFAULT_KICKLET_KICK_ID = "4000584";

export type KickletPoints = {
  ok: boolean;
  found: boolean;
  viewer: string;
  points: number;
  error?: string;
};

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

function findViewerRanking(data: unknown, viewer: string) {
  const normalized = cleanViewer(viewer).toLowerCase();
  const rows = Array.isArray((data as { ranking?: unknown[] })?.ranking)
    ? ((data as { ranking: unknown[] }).ranking)
    : [];

  return (
    rows.find((row) => {
      const name = String(
        (row as { viewerKickUsername?: unknown; name?: unknown })
          ?.viewerKickUsername ||
          (row as { name?: unknown })?.name ||
          "",
      )
        .trim()
        .replace(/^@+/, "")
        .toLowerCase();

      return name === normalized;
    }) || null
  );
}

export async function lookupKickletPoints(viewer: string): Promise<KickletPoints> {
  const clean = cleanViewer(viewer);

  if (!clean) {
    return {
      ok: false,
      found: false,
      viewer: clean,
      points: 0,
      error: "Missing Kick username",
    };
  }

  const kickId = getKickletKickId();
  const url = new URL(
    `https://kicklet.app/api/stats/public/${encodeURIComponent(
      kickId,
    )}/viewer/ranking`,
  );

  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("orderBy", "points");
  url.searchParams.set("order", "desc");
  url.searchParams.set("search", clean);

  const response = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      referer: "https://kicklet.app/user/eazykeee/shop",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      found: false,
      viewer: clean,
      points: 0,
      error: `Kicklet points failed (${response.status})`,
    };
  }

  const data = await response.json();
  const row = findViewerRanking(data, clean) as {
    points?: unknown;
    viewerKickUsername?: unknown;
    name?: unknown;
  } | null;
  const points = Number(row?.points);

  if (!row || !Number.isFinite(points)) {
    return {
      ok: true,
      found: false,
      viewer: clean,
      points: 0,
      error: "Kicklet user not found",
    };
  }

  return {
    ok: true,
    found: true,
    viewer: String(row.viewerKickUsername || row.name || clean),
    points,
  };
}
