import { fetchKickletItems } from "@/lib/server/kicklet-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await fetchKickletItems();

    return Response.json({ items });
  } catch (error) {
    console.error(
      "[API /api/items] failed:",
      error instanceof Error ? error.message : String(error),
    );

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Could not load items",
      },
      { status: 502 },
    );
  }
}
