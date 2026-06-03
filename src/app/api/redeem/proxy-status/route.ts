import { backendRequest } from "@/lib/server/backend-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await backendRequest("/proxy-status"));
  } catch (error) {
    return Response.json(
      {
        proxyStatus: {
          ok: false,
          state: "unknown",
          title: "Proxy status hiba",
          summary:
            error instanceof Error ? error.message : "Nem sikerult lekerdezni",
          publishedAt: null,
          checkedAt: new Date().toISOString(),
        },
      },
      { status: 200 },
    );
  }
}
