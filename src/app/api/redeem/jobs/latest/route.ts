import { NextRequest } from "next/server";
import { backendRequest } from "@/lib/server/backend-client";
import { readSession } from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = readSession(request);

  if (!session?.userName) {
    return Response.json({ job: null });
  }

  return Response.json(
    await backendRequest(
      `/users/${encodeURIComponent(session.userName)}/jobs/latest`,
    ),
  );
}
