import { NextRequest, NextResponse } from "next/server";
import {
  ensureFreshSession,
  getMaxRedeemQuantity,
} from "@/lib/server/kick-api";
import { backendRequest } from "@/lib/server/backend-client";
import { readSession, setSessionCookie } from "@/lib/server/kick-session";
import { findKickletItem } from "@/lib/server/kicklet-items";
import { lookupKickletPoints } from "@/lib/server/kicklet-points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = readSession(request);

  if (!session) {
    return Response.json({ error: "Kick authorization required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    itemId?: string;
    quantity?: number;
  } | null;
  const itemId = String(body?.itemId || "").trim();
  const quantity = Math.floor(Number(body?.quantity || 0));
  const maxQuantity = getMaxRedeemQuantity();

  if (!itemId) {
    return Response.json({ error: "Item is required" }, { status: 400 });
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

  const itemPrice = Number(item.price || 0);
  if (itemPrice > 0) {
    const points = await lookupKickletPoints(session.userName);
    const totalCost = itemPrice * quantity;

    if (points.ok && points.found && points.points < totalCost) {
      return Response.json(
        {
          error: `Nincs eleg pont (${points.points}/${totalCost})`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const freshness = await ensureFreshSession(session);
    const backend = await backendRequest<{ job: unknown }>("/jobs", {
      method: "POST",
      body: JSON.stringify({
        session: {
          accessToken: freshness.session.accessToken,
          userName: freshness.session.userName,
        },
        item,
        quantity,
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
