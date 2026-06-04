import { NextRequest } from "next/server";
import { backendRequest } from "@/lib/server/backend-client";
import { readSession } from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JobResponse = {
  job?: {
    userName?: string | null;
  };
};

function cleanUserName(value: string | null | undefined) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = readSession(request);

  if (!session?.userName) {
    return Response.json({ error: "Kick auth szükséges" }, { status: 401 });
  }

  try {
    const data = await backendRequest<JobResponse>(`/jobs/${encodeURIComponent(id)}`);

    if (cleanUserName(data.job?.userName) !== cleanUserName(session.userName)) {
      return Response.json({ error: "Nincs jogosultság ehhez a jobhoz" }, { status: 403 });
    }

    return Response.json(data);
  } catch {
    return Response.json({ error: "Job nem található" }, { status: 404 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = readSession(request);

  if (!session?.userName) {
    return Response.json({ error: "Kick auth szükséges" }, { status: 401 });
  }

  try {
    const current = await backendRequest<JobResponse>(`/jobs/${encodeURIComponent(id)}`);

    if (cleanUserName(current.job?.userName) !== cleanUserName(session.userName)) {
      return Response.json({ error: "Nincs jogosultság ehhez a jobhoz" }, { status: 403 });
    }

    return Response.json(
      await backendRequest<JobResponse>(`/jobs/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    );
  } catch {
    return Response.json({ error: "Job nem található" }, { status: 404 });
  }
}
