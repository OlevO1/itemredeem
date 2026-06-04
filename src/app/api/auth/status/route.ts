import { NextRequest } from "next/server";
import {
  getMaxRedeemQuantity,
  getRedeemDelayMs,
  isKickConfigured,
} from "@/lib/server/kick-api";
import { isTestAuthEnabled, readSession } from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = readSession(request);

  return Response.json({
    authenticated: Boolean(session?.accessToken && session.expiresAt > Date.now()),
    configured: isTestAuthEnabled() || isKickConfigured(),
    scope: session?.scope || null,
    expiresAt: session?.expiresAt || null,
    userName: session?.userName || null,
    userId: session?.userId || null,
    redeemDelayMs: getRedeemDelayMs(),
    maxQuantity: getMaxRedeemQuantity(),
  });
}
