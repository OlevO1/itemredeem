import { NextRequest } from "next/server";
import { fetchKickletItems } from "@/lib/server/kicklet-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const force = request.nextUrl.searchParams.get("refresh") === "1";
    const items = await fetchKickletItems({ force });

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
