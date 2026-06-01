import { NextRequest } from "next/server";
import { backendRequest } from "@/lib/server/backend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    return Response.json(await backendRequest(`/jobs/${encodeURIComponent(id)}`));
  } catch {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
}
