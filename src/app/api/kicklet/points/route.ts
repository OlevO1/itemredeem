import { NextRequest } from "next/server";
import { lookupKickletPoints } from "@/lib/server/kicklet-points";
import { readSession } from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = readSession(request);
  const userName = session?.userName?.trim();

  if (!session || !userName) {
    return Response.json(
      {
        ok: false,
        found: false,
        points: 0,
        error: "Kick user:read authorization required",
      },
      { status: 401 },
    );
  }

  const result = await lookupKickletPoints(userName);

  if (!result.ok) {
    console.error("[API /api/kicklet/points] failed:", result.error || "Unknown error");
  }

  return Response.json(result);
}
