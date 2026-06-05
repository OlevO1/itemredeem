import { NextRequest, NextResponse } from "next/server";
import {
  ensureFreshSession,
  getMaxRedeemQuantity,
  getRedeemDelayMs,
  isKickConfigured,
} from "@/lib/server/kick-api";
import {
  clearSessionCookie,
  isTestAuthEnabled,
  readSession,
  setSessionCookie,
} from "@/lib/server/kick-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let session = readSession(request);
  let refreshed = false;

  if (session && !isTestAuthEnabled() && session.expiresAt <= Date.now()) {
    try {
      const freshness = await ensureFreshSession(session);
      session = freshness.session;
      refreshed = freshness.refreshed;
    } catch {
      session = null;
    }
  }

  const response = NextResponse.json({
    authenticated: Boolean(session?.accessToken && session.expiresAt > Date.now()),
    configured: isTestAuthEnabled() || isKickConfigured(),
    scope: session?.scope || null,
    expiresAt: session?.expiresAt || null,
    userName: session?.userName || null,
    userId: session?.userId || null,
    redeemDelayMs: getRedeemDelayMs(),
    maxQuantity: getMaxRedeemQuantity(),
  });

  if (!session && !isTestAuthEnabled()) {
    clearSessionCookie(response);
  } else if (session && refreshed) {
    setSessionCookie(response, session);
  }

  return response;
}
