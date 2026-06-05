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
  } | null;
  const itemId = String(body?.itemId || "").trim();
  const quantity = Math.floor(Number(body?.quantity || 0));
  const turnstileToken = String(body?.turnstileToken || "").trim();
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

  const itemPrice = Number(item.price || 0);
  if (itemPrice > 0) {
    const points = await lookupKickletPoints(session.userName);
    const totalCost = itemPrice * quantity;

    if (points.ok && points.found && points.points < totalCost) {
      return Response.json(
        {
          error: `Nincs elég pont (${points.points}/${totalCost})`,
        },
        { status: 400 },
      );
    }
  }

  try {
    const freshness = await ensureFreshSession(session);
    const requestOrigin = request.headers.get("origin") || "";
    const turnstileHost = requestOrigin
      ? safeHostname(requestOrigin) || request.nextUrl.hostname
      : request.nextUrl.hostname;
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
        turnstileToken,
        turnstileHost,
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

function safeHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
