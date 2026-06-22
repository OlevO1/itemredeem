import { NextRequest, NextResponse } from "next/server";
import {
  ensureFreshSession,
  getMaxRedeemQuantity,
} from "@/lib/server/kick-api";
import { backendRequest } from "@/lib/server/backend-client";
import {
  clearSessionCookie,
  readSession,
  setSessionCookie,
} from "@/lib/server/kick-session";
import { findKickletItem } from "@/lib/server/kicklet-items";
import { lookupKickletPoints } from "@/lib/server/kicklet-points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanUserName(value: string | null | undefined) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

export async function POST(request: NextRequest) {
  const session = readSession(request);

  if (!session) {
    const response = NextResponse.json(
      { error: "Kick authorization required. Please sign in again." },
      { status: 401 },
    );
    clearSessionCookie(response);
    return response;
  }

  const body = (await request.json().catch(() => null)) as {
    itemId?: string;
    quantity?: number;
    turnstileToken?: string;
    startNowOverride?: boolean;
  } | null;
  const itemId = String(body?.itemId || "").trim();
  const quantity = Math.floor(Number(body?.quantity || 0));
  const turnstileToken = String(body?.turnstileToken || "").trim();
  const startNowOverride = Boolean(body?.startNowOverride);
  const maxQuantity = getMaxRedeemQuantity();

  if (!itemId) {
    return Response.json({ error: "Item is required" }, { status: 400 });
  }

  if (!turnstileToken) {
    return Response.json(
      { error: "Turnstile verification required" },
      { status: 400 },
    );
  }

  if (!Number.isFinite(quantity) || quantity < 1 || quantity > maxQuantity) {
    return Response.json(
      { error: `Quantity must be between 1 and ${maxQuantity}` },
      { status: 400 },
    );
  }

  const item = await findKickletItem(itemId);

  if (!item) {
    return Response.json({ error: "Item not found" }, { status: 404 });
  }

  if (!session.userName) {
    return Response.json(
      { error: "Re-authorize Kick with user:read first" },
      { status: 401 },
    );
  }

  if (startNowOverride && cleanUserName(session.userName) !== "olevo") {
    return Response.json(
      { error: "Azonnali indítás csak olevo usernek engedélyezett" },
      { status: 403 },
    );
  }

  const itemPrice = Number(item.price || 0);
  if (itemPrice > 0) {
    const points = await lookupKickletPoints(session.userName);
    const totalCost = itemPrice * quantity;

    if (!points.ok) {
      return Response.json(
        {
          error: points.error || "Kicklet API jelenleg nem elérhető",
        },
        { status: points.unavailable ? 503 : 502 },
      );
    }

    if (!points.found) {
      return Response.json(
        {
          error: points.error || "Kicklet user nem található",
        },
        { status: 404 },
      );
    }

    if (points.points < totalCost) {
      return Response.json(
        {
          error: `Nincs elég pont (${points.points}/${totalCost})`,
        },
        { status: 400 },
      );
    }
  }

  let freshness: Awaited<ReturnType<typeof ensureFreshSession>>;

  try {
    freshness = await ensureFreshSession(session);
  } catch {
    const response = NextResponse.json(
      { error: "Kick authorization expired. Please sign in again." },
      { status: 401 },
    );
    clearSessionCookie(response);
    return response;
  }

  try {
    const backend = await backendRequest<{ job: unknown }>("/jobs", {
      method: "POST",
      body: JSON.stringify({
        session: {
          accessToken: freshness.session.accessToken,
          refreshToken: freshness.session.refreshToken,
          expiresAt: freshness.session.expiresAt,
          userName: freshness.session.userName,
        },
        item,
        quantity,
        startNowOverride,
        turnstileToken,
        turnstileHost: request.nextUrl.hostname,
      }),
    });
    const response = NextResponse.json(backend);

    if (freshness.refreshed) {
      setSessionCookie(response, freshness.session);
    }

    return response;
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not start redeem job",
      },
      { status: 502 },
    );
  }
}
